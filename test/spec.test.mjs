import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateJsonSchema } from "@red-cup-engineering/json-schema-services-section/validation";
import { OPERATOR_NAMES } from "../scripts/language.mjs";
import { admitSpec, specProblems } from "../scripts/spec.mjs";
import { loadSpec } from "../scripts/reproduce-paper-claims.mjs";
import { json, paperFixture } from "./helpers.mjs";

const schema = json("schemas/claim-spec.schema.json");
const valid = (value) => validateJsonSchema(value, schema).valid;
const BASE = { specVersion: "1", records: { r: "r.json" } };
const claim = (extra = {}) => ({ id: "a", manuscript: "m", stated: 1, expression: 1, basis: "b", ...extra });

test("the schema declares exactly the operators the evaluator implements", () => {
  const listed = schema.$defs.operatorExpression.oneOf.map((branch) => branch.required[0]).sort();
  assert.deepEqual(listed, [...OPERATOR_NAMES].sort());
});

test("the white-repopulation claims and tables files satisfy the schema and are admitted", () => {
  for (const name of ["claims", "tables"]) {
    const result = validateJsonSchema(JSON.parse(readFileSync(join(paperFixture, "claims", `${name}.json`), "utf8")), schema);
    assert.deepEqual(result.issues, [], name);
  }
  const merged = loadSpec(paperFixture, "claims/claims.json");
  assert.deepEqual(specProblems(merged), []);
  assert.equal(merged.claims.length, 17);
});

// Each case is judged by the schema and by the code; they must agree.
const CASES = [
  ["minimal", BASE, true],
  ["unknown top-level key", { ...BASE, extra: 1 }, false],
  ["wrong version", { ...BASE, specVersion: "2" }, false],
  ["claim ok", { ...BASE, claims: [claim()] }, true],
  ["claim missing basis", { ...BASE, claims: [{ id: "a", manuscript: "m", stated: 1, expression: 1 }] }, false],
  ["two operator keys", { ...BASE, claims: [claim({ expression: { sum: [], add: [] } })] }, false],
  ["unknown operator", { ...BASE, claims: [claim({ expression: { frobnicate: 1 } })] }, false],
  ["percent without places", { ...BASE, claims: [claim({ expression: { percent: { numerator: 1, denominator: 2 } } })] }, false],
  ["percent bad rounding", { ...BASE, claims: [claim({ expression: { percent: { numerator: 1, denominator: 2, places: 2, rounding: "up" } } })] }, false],
  ["nested expression error", { ...BASE, claims: [claim({ expression: { sum: { slice: { array: [], start: 0, bogus: 1 } } } })] }, false],
  ["where needs predicates", { ...BASE, claims: [claim({ expression: { any: { array: [], where: { id: {} } } } })] }, false],
  ["where unknown predicate", { ...BASE, claims: [claim({ expression: { any: { array: [], where: { id: { contains: "x" } } } } })] }, false],
  ["forEach name must be a name", { ...BASE, claims: [claim({ forEach: [{ over: [], as: "1x" }] })] }, false],
  ["record path escapes", { ...BASE, records: { r: "../r.json" } }, false],
  ["record path absolute", { ...BASE, records: { r: "/etc/passwd" } }, false],
  ["source binding slice must be integers", { ...BASE, bindings: { b: { record: "r", slice: ["a"] } } }, false],
  ["source binding groupBy width", { ...BASE, bindings: { b: { record: "r", groupBy: { key: "/k", value: "/v", width: 0 } } } }, false],
  ["reserved binding name", { ...BASE, bindings: { claimResults: 1 } }, false],
  ["table needs an output", { ...BASE, tables: [{ id: "t" }] }, false],
  ["table ok", { ...BASE, tables: [{ id: "t", csv: { path: "out/t.csv", columns: [{ header: "h", value: 1 }] } }] }, true],
  ["csv path escapes", { ...BASE, tables: [{ id: "t", csv: { path: "../t.csv", columns: [{ header: "h", value: 1 }] } }] }, false],
  ["document ok", { ...BASE, tables: [{ id: "t", markdown: { caption: "c", columns: [{ header: "h", value: 1 }] } }], documents: [{ path: "d.md", blocks: [{ heading: { level: 1, text: "T" } }, { paragraph: "p" }, { table: "t" }] }] }, true],
  ["heading level", { ...BASE, documents: [{ path: "d.md", blocks: [{ heading: { level: 7, text: "T" } }] }] }, false],
  ["column align", { ...BASE, tables: [{ id: "t", markdown: { caption: "c", columns: [{ header: "h", value: 1, align: "middle" }] } }] }, false],
];
for (const [label, spec, ok] of CASES) {
  test(`schema and admission agree: ${label}`, () => {
    assert.equal(valid(spec), ok, `schema: ${JSON.stringify(validateJsonSchema(spec, schema).issues).slice(0, 300)}`);
    assert.equal(specProblems(spec).length === 0, ok, specProblems(spec).join("; "));
  });
}

test("checks the code makes that a schema cannot", () => {
  const unknownTable = { ...BASE, documents: [{ path: "d.md", blocks: [{ table: "ghost" }] }] };
  assert.match(specProblems(unknownTable).join(), /no table ghost/u);
  const twice = { ...BASE, resultsPath: "x.json", claims: [claim()], tables: [{ id: "t", csv: { path: "x.json", columns: [{ header: "h", value: 1 }] } }] };
  assert.match(specProblems(twice).join(), /already written/u);
  const noMarkdown = { ...BASE, tables: [{ id: "t", csv: { path: "t.csv", columns: [{ header: "h", value: 1 }] } }], documents: [{ path: "d.md", blocks: [{ table: "t" }] }] };
  assert.match(specProblems(noMarkdown).join(), /no markdown output/u);
  assert.throws(() => admitSpec({ ...BASE, tables: "tables.json" }), /must be an array/u);
});

test("every problem is listed with its path", () => {
  const problems = specProblems({ ...BASE, claims: [claim({ expression: { nope: 1 } }), claim({ id: undefined, expression: { add: 1 } })] });
  assert.ok(problems.some((p) => p.startsWith("spec/claims/0/expression/nope")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("spec/claims/1/expression/add")), problems.join("\n"));
});
