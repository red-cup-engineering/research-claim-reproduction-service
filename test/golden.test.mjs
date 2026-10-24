// The white-repopulation paper is the golden case: running the CLI on a copy of its tree reproduces
// the Python-era outputs byte for byte, and the v0.1.0 CRLF release digests.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadSpec } from "../scripts/reproduce-paper-claims.mjs";
import { projectDerivedTables } from "../scripts/project-derived-tables.mjs";
import { reproduceStatedClaims } from "../scripts/reproduce-stated-claims.mjs";
import { paperCopy, paperFixture, root } from "./helpers.mjs";

const cli = (args) => spawnSync(process.execPath, [join(root, "scripts", "reproduce-paper-claims.mjs"), ...args], { encoding: "utf8" });
const golden = (path) => readFileSync(join(paperFixture, path));
const GOLDEN_FILES = ["data/derived/births-1790-1859.csv", "data/derived/us-migration-growth-1790-1860.csv", "data/derived/claims.json", "manuscript/90-appendix-a-tables.md"];

test("the CLI reproduces every golden output byte for byte and exits 0", () => {
  const directory = paperCopy();
  const run = cli(["--root", directory, "--spec", "claims/claims.json"]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^26\/26 claims reproduced; wrote /u);
  for (const path of GOLDEN_FILES) assert.ok(readFileSync(join(directory, path)).equals(golden(path)), `${path} differs from the golden output`);
});

test("claims.json is semantically the Python result: 26 claims, same ids, stated, derived, agrees, basis, in order", () => {
  const produced = JSON.parse(readFileSync(join(paperFixture, "data/derived/claims.json"), "utf8"));
  const spec = loadSpec(paperFixture, "claims/claims.json");
  const recordTexts = Object.fromEntries(Object.entries(spec.records).map(([name, path]) => [name, readFileSync(join(paperFixture, path), "utf8")]));
  const { results, total, agreed, ok } = reproduceStatedClaims({ recordTexts, spec });
  assert.deepEqual(results, produced);
  assert.deepEqual([total, agreed, ok], [26, 26, true]);
  assert.equal(new Set(results.map((claim) => claim.id)).size, 26);
  assert.deepEqual(results.map((claim) => typeof claim.stated), produced.map((claim) => typeof claim.stated));
});

test("the CRLF variants reproduce the digests recorded in the v0.1.0 release bundle", () => {
  const spec = loadSpec(paperFixture, "claims/claims.json");
  const recordTexts = Object.fromEntries(Object.entries(spec.records).map(([name, path]) => [name, readFileSync(join(paperFixture, path), "utf8")]));
  const { files } = projectDerivedTables({ recordTexts, spec });
  const manifest = JSON.parse(golden("archive/v0.1.0-publication-digests.json"));
  const csvs = files.filter((file) => file.variants !== undefined);
  assert.equal(csvs.length, 2);
  for (const file of csvs) {
    const recorded = manifest.files[`data/${file.path.split("/").pop()}`];
    assert.deepEqual(file.variants.crlf, { sha256: recorded.sha256, bytes: recorded.bytes }, file.path);
    assert.equal(createHash("sha256").update(file.text.replaceAll("\n", "\r\n")).digest("hex"), recorded.sha256);
  }
  for (const file of files) {
    assert.equal(file.sha256, createHash("sha256").update(readFileSync(join(paperFixture, file.path))).digest("hex"), file.path);
    assert.equal(file.bytes, golden(file.path).length);
  }
});

test("--check passes on a reproduced tree and reports drift on an edited or missing output", () => {
  const directory = paperCopy();
  assert.equal(cli(["--root", directory, "--spec", "claims/claims.json"]).status, 0);
  const clean = cli(["--root", directory, "--spec", "claims/claims.json", "--check"]);
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /checked 4 files, 0 drifted/u);
  writeFileSync(join(directory, "data/derived/births-1790-1859.csv"), "edited\n");
  const drifted = cli(["--root", directory, "--spec", "claims/claims.json", "--check"]);
  assert.equal(drifted.status, 1);
  assert.match(drifted.stderr, /DRIFT data\/derived\/births-1790-1859\.csv/u);
});

test("a changed record moves the derived value and the CLI exits 1, naming the claim", () => {
  const directory = paperCopy();
  const path = join(directory, "data/records/2026-10-17-captive-birth-shares-source-series.json");
  const record = JSON.parse(readFileSync(path, "utf8"));
  record.source.captive_births_1790_1859_by_decade[1] += 1;
  writeFileSync(path, JSON.stringify(record));
  const run = cli(["--root", directory, "--spec", "claims/claims.json"]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /DISAGREES captive-share-1800-1849-numerator: stated 5167522 derived 5167523/u);
  assert.match(run.stdout, /^\d+\/26 claims reproduced/u);
  const appendix = readFileSync(join(directory, "manuscript/90-appendix-a-tables.md"), "utf8");
  assert.match(appendix, /Every quantitative claim in the paper and its derivation \(\d+ of 26 reproduced\)/u);
});

test("the CLI refuses unreadable, escaping and malformed inputs with exit 2", () => {
  const directory = paperCopy();
  assert.equal(cli([]).status, 2);
  assert.equal(cli(["--root", directory, "--spec", "claims/absent.json"]).status, 2);
  assert.equal(cli(["--root", directory, "--spec", "../claims/claims.json"]).status, 2);
  const escaping = mkdtempSync(join(tmpdir(), "claim-repro-escape-"));
  cpSync(join(paperFixture, "claims"), join(escaping, "claims"), { recursive: true });
  const spec = JSON.parse(readFileSync(join(escaping, "claims/claims.json"), "utf8"));
  spec.records.births = "../outside.json";
  writeFileSync(join(escaping, "claims/claims.json"), JSON.stringify(spec));
  const run = cli(["--root", escaping, "--spec", "claims/claims.json"]);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /not a relative path inside the root|not admissible/u);
  assert.match(cli(["--help"]).stdout, /usage: reproduce-paper-claims/u);
});

const real = process.env.WHITE_REPOPULATION_ROOT;
test("optionally: the live paper tree (WHITE_REPOPULATION_ROOT) is reproduced by its own claims files", { skip: real ? false : "set WHITE_REPOPULATION_ROOT to a white-repopulation working tree" }, () => {
  const run = cli(["--root", real, "--spec", "claims/claims.json", "--check"]);
  assert.equal(run.status, 0, run.stderr);
});
