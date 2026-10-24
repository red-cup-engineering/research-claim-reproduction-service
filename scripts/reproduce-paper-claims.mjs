#!/usr/bin/env node
// reproduce-paper-claims --root <paper repo> --spec claims/claims.json [--check]
// Reads the records a claim-spec names from disk, derives every claim, writes (or with --check, compares)
// every output file, and exits 1 when any claim disagrees with the value the paper states.
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { admitRequest, evaluateClaims } from "./engine.mjs";
import { canonicalText } from "./exact.mjs";
import { isSafeRelativePath } from "./spec.mjs";
import { projectDerivedTables } from "./project-derived-tables.mjs";

const USAGE = "usage: reproduce-paper-claims --root <paper repo> --spec <claims.json relative to root> [--check]\n";
const TABLE_FILE_KEYS = ["$schema", "specVersion", "description", "bindings", "tables", "documents"];

function readInside(root, relative, what) {
  if (!isSafeRelativePath(relative)) throw new TypeError(`${what}: ${JSON.stringify(relative)} is not a relative path inside the root`);
  let real;
  try { real = realpathSync(join(root, relative)); } catch (error) { throw new TypeError(`${what}: cannot read ${relative}: ${error.code ?? error.message}`); }
  if (real !== root && !real.startsWith(root + sep)) throw new TypeError(`${what}: ${relative} resolves outside the root`);
  return readFileSync(real, "utf8");
}
function parseJsonFile(text, what) {
  try { return JSON.parse(text); } catch (error) { throw new TypeError(`${what} is not valid JSON: ${error.message}`); }
}

/** The spec file, with a `tables` path replaced by that file's tables, documents and extra bindings. */
export function loadSpec(root, specPath) {
  const spec = parseJsonFile(readInside(root, specPath, "spec"), specPath);
  if (typeof spec?.tables !== "string") return spec;
  const tablesPath = join(dirname(specPath), spec.tables).split(sep).join("/");
  const extra = parseJsonFile(readInside(root, tablesPath, "tables"), tablesPath);
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) throw new TypeError(`${tablesPath} must be an object`);
  for (const key of Object.keys(extra)) if (!TABLE_FILE_KEYS.includes(key)) throw new TypeError(`${tablesPath} does not admit ${key}`);
  if (extra.specVersion !== undefined && extra.specVersion !== spec.specVersion) throw new TypeError(`${tablesPath} specVersion differs from the spec's`);
  for (const key of Object.keys(extra.bindings ?? {})) if (Object.hasOwn(spec.bindings ?? {}, key)) throw new TypeError(`${tablesPath} redefines binding ${key}`);
  if (spec.documents !== undefined && extra.documents !== undefined) throw new TypeError("documents are declared in both the spec and its tables file");
  const { tables: _path, ...rest } = spec;
  return { ...rest, bindings: { ...(spec.bindings ?? {}), ...(extra.bindings ?? {}) }, tables: extra.tables ?? [], ...(extra.documents === undefined && spec.documents === undefined ? {} : { documents: extra.documents ?? spec.documents }) };
}

export function run({ argv, stdout, stderr, cwd = process.cwd() }) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { root: { type: "string" }, spec: { type: "string" }, check: { type: "boolean", default: false }, help: { type: "boolean", default: false } }, allowPositionals: false }));
  } catch (error) { stderr.write(`${error.message}\n${USAGE}`); return 2; }
  if (values.help) { stdout.write(USAGE); return 0; }
  if (values.root === undefined || values.spec === undefined) { stderr.write(USAGE); return 2; }

  try {
    const root = realpathSync(resolve(cwd, values.root));
    const spec = loadSpec(root, values.spec);
    const recordTexts = {};
    for (const [name, path] of Object.entries(spec.records ?? {})) recordTexts[name] = readInside(root, path, `record ${name}`);
    const request = { recordTexts, spec };
    const { files, claims } = projectDerivedTables(request);
    const { spec: admitted, records } = admitRequest(request, "reproduce-paper-claims");
    const failures = evaluateClaims(admitted, records).filter((result) => !result.agrees);
    for (const failure of failures) stderr.write(`DISAGREES ${failure.id}: stated ${canonicalText(failure.stated)} derived ${canonicalText(failure.derived)}\n`);

    const drift = [];
    for (const file of files) {
      const target = join(root, file.path);
      if (values.check) {
        let existing = null;
        try { existing = readFileSync(target, "utf8"); } catch { /* absent counts as drift */ }
        if (existing !== file.text) drift.push(file.path);
      } else {
        mkdirSync(dirname(target), { recursive: true });
        const parent = realpathSync(dirname(target));
        if (parent !== root && !parent.startsWith(root + sep)) throw new TypeError(`output ${file.path} resolves outside the root`);
        const temporary = `${target}.${process.pid}.tmp`;
        writeFileSync(temporary, file.text, "utf8");
        renameSync(temporary, target);
      }
    }
    for (const path of drift) stderr.write(`DRIFT ${path}: the file on disk is not what the records and spec produce\n`);
    stdout.write(`${claims.agreed}/${claims.total} claims reproduced; ${values.check ? `checked ${files.length} files, ${drift.length} drifted` : `wrote ${files.map((file) => file.path).join(", ") || "no files"}`}\n`);
    return failures.length > 0 || drift.length > 0 ? 1 : 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.name : "Error"}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (import.meta.main) process.exitCode = run({ argv: process.argv.slice(2), stdout: process.stdout, stderr: process.stderr });
