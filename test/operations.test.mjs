import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectDerivedTables } from "../scripts/project-derived-tables.mjs";
import { reproduceStatedClaims } from "../scripts/reproduce-stated-claims.mjs";
import { claimOf, root } from "./helpers.mjs";

const offer = (name) => JSON.parse(readFileSync(join(root, `data/records/offers/${name}.json`), "utf8"));
const reproduceBody = offer("reproduce-stated-claims").bodyExample;
const projectBody = offer("project-derived-tables").bodyExample;

test("projectDerivedTables returns CSV, Pandoc Markdown, sha256 and byte length; same bytes every time", () => {
  const first = projectDerivedTables(projectBody);
  assert.deepEqual(first, projectDerivedTables(JSON.parse(JSON.stringify(projectBody))));
  assert.deepEqual(first.files.map((file) => file.path), ["tables/groups.csv", "tables.md"]);
  const [csv, markdown] = first.files;
  assert.equal(csv.text, "group,n,share_pct\n0,12,24.0\n1,30,60.0\n2,8,16.0\n");
  assert.equal(markdown.text, "# Tables {#tables}\n\nTable: Respondents by group. {#tbl:groups}\n\n| Group | Respondents |\n|---|--:|\n| 0 | 12 |\n| 1 | 30 |\n| 2 | 8 |\n");
  for (const file of first.files) {
    assert.equal(file.sha256, createHash("sha256").update(file.text).digest("hex"));
    assert.equal(file.bytes, Buffer.byteLength(file.text));
    assert.equal(file.variants, undefined);
  }
});

test("csv cells are quoted per RFC 4180; markdown cells escape pipes; crlfDigest adds a legacy variant", () => {
  const spec = {
    specVersion: "1",
    records: { r: "r.json" },
    tables: [{
      id: "t",
      iterate: { over: { pointer: { record: "r", path: "/rows" } }, as: "row" },
      csv: { path: "t.csv", crlfDigest: true, columns: [{ header: "a,b", value: { get: { from: { ref: "row" }, key: "text" } } }, { header: "n", value: { get: { from: { ref: "row" }, key: "n" } } }] },
      markdown: { caption: "T", label: "tbl:custom", columns: [{ header: "a|b", align: "center", value: { get: { from: { ref: "row" }, key: "text" } } }] },
    }],
    documents: [{ path: "t.md", blocks: [{ paragraph: "intro" }, { table: "t" }] }],
  };
  const records = { r: { rows: [{ text: 'say "hi", ok', n: 1 }, { text: "a|b", n: 2.5 }] } };
  const { files } = projectDerivedTables({ records, spec });
  assert.equal(files[0].text, '"a,b",n\n"say ""hi"", ok",1\na|b,2.5\n');
  assert.deepEqual(files[0].variants.crlf.sha256, createHash("sha256").update(files[0].text.replaceAll("\n", "\r\n")).digest("hex"));
  assert.equal(files[1].text, "intro\n\nTable: T {#tbl:custom}\n\n| a\\|b |\n|:-:|\n| say \"hi\", ok |\n| a\\|b |\n");
});

test("refusals: malformed request, unknown key, unsupplied record, non-scalar cell", () => {
  assert.throws(() => reproduceStatedClaims(null), TypeError);
  assert.throws(() => reproduceStatedClaims({ spec: reproduceBody.spec, other: 1 }), /does not admit other/u);
  assert.throws(() => reproduceStatedClaims({ spec: reproduceBody.spec }), /were not supplied: survey/u);
  assert.throws(() => reproduceStatedClaims({ records: { survey: {} }, spec: { specVersion: "1" } }), /spec\/records/u);
  const spec = { specVersion: "1", records: {}, tables: [{ id: "t", csv: { path: "t.csv", columns: [{ header: "h", value: [1] }] } }] };
  assert.throws(() => projectDerivedTables({ spec }), /scalar/u);
  assert.throws(() => reproduceStatedClaims({ spec: { specVersion: "1", records: {}, claims: [claimOf({ nope: 1 }, 1)] } }), /unknown operator nope/u);
});

function command(script, lines) {
  const run = spawnSync(process.execPath, [join(root, "scripts", script)], { input: lines.map((line) => JSON.stringify(line)).join("\n") + "\n", encoding: "utf8" });
  return { status: run.status, lines: run.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)), stderr: run.stderr };
}

test("each command reads one JSON value per line and writes one per line; refusals exit 2", () => {
  const reproduced = command("reproduce-stated-claims.mjs", [reproduceBody, { spec: { specVersion: "1" } }]);
  assert.equal(reproduced.status, 2);
  assert.equal(reproduced.lines[0].total, 3);
  assert.equal(reproduced.lines[0].ok, false);
  assert.deepEqual(reproduced.lines[0].disagreed, ["share-group-b"]);
  assert.equal(reproduced.lines[1].ok, false);
  assert.equal(reproduced.lines[1].refusal.reason, "TypeError");
  const projected = command("project-derived-tables.mjs", [projectBody]);
  assert.equal(projected.status, 0, projected.stderr);
  assert.deepEqual(projected.lines[0], JSON.parse(JSON.stringify(projectDerivedTables(projectBody))));
  assert.equal(command("project-derived-tables.mjs", [{ spec: projectBody.spec, extra: 1 }]).lines[0].refusal.reason, "InvalidInput");
  for (const script of ["reproduce-stated-claims.mjs", "project-derived-tables.mjs"]) {
    const help = spawnSync(process.execPath, [join(root, "scripts", script), "--help"], { encoding: "utf8" });
    assert.match(help.stdout, /^(reproduceStatedClaims|projectDerivedTables) — /u);
  }
});
