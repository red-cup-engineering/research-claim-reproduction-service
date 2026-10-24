// Structural admission of a claim-spec (claims, tables and documents in one object).
// Every problem is listed with its JSON-pointer-like path; nothing is evaluated here.
import { NAME, RESERVED_NAMES, checkExpression } from "./language.mjs";
import { isObject } from "./exact.mjs";

export const SPEC_VERSION = "1";
const TOP_KEYS = ["$schema", "specVersion", "description", "records", "bindings", "claims", "resultsPath", "tables", "documents"];
const SOURCE_KEYS = ["record", "path", "slice", "groupBy"];
const ALIGNS = ["left", "right", "center"];

export function isSafeRelativePath(path) {
  return typeof path === "string" && path !== "" && !path.startsWith("/") && !path.includes("\\") && !path.includes("\0")
    && !/^[A-Za-z]:/u.test(path) && !path.split("/").some((part) => part === ".." || part === "." || part === "");
}

export const isSourceBinding = (binding) => isObject(binding) && Object.hasOwn(binding, "record");

function checkName(value, path, problems) {
  if (typeof value !== "string" || !NAME.test(value) || RESERVED_NAMES.includes(value)) problems.push(`${path}: must be a name matching ${NAME} and not reserved`);
}
function checkOnly(object, allowed, path, problems) {
  for (const key of Object.keys(object)) if (!allowed.includes(key)) problems.push(`${path}: does not admit ${key}`);
}
function checkBinding(binding, path, problems) {
  if (!isSourceBinding(binding)) { checkExpression(binding, path, problems); return; }
  checkOnly(binding, SOURCE_KEYS, path, problems);
  if (typeof binding.record !== "string" || binding.record === "") problems.push(`${path}/record: must be a record name`);
  if (Object.hasOwn(binding, "path") && typeof binding.path !== "string") problems.push(`${path}/path: must be a JSON Pointer string`);
  if (Object.hasOwn(binding, "slice")) {
    const slice = binding.slice;
    const ok = Array.isArray(slice) && slice.length >= 1 && slice.length <= 2 && slice.every((n) => Number.isInteger(n) && n >= 0);
    if (!ok) problems.push(`${path}/slice: must be [start] or [start, end] with non-negative integers (half-open)`);
  }
  if (Object.hasOwn(binding, "groupBy")) {
    const group = binding.groupBy;
    const here = `${path}/groupBy`;
    if (!isObject(group)) { problems.push(`${here}: must be an object`); return; }
    checkOnly(group, ["key", "value", "width", "scale", "require"], here, problems);
    for (const field of ["key", "value"]) if (typeof group[field] !== "string") problems.push(`${here}/${field}: must be a JSON Pointer string relative to each element`);
    if (!Number.isInteger(group.width) || group.width < 1) problems.push(`${here}/width: must be a positive integer`);
    if (Object.hasOwn(group, "scale") && (!Number.isInteger(group.scale) || group.scale < 1)) problems.push(`${here}/scale: must be a positive integer`);
    if (Object.hasOwn(group, "require")) {
      const need = group.require;
      if (!isObject(need) || !Number.isInteger(need.from) || !Number.isInteger(need.to) || need.from > need.to) problems.push(`${here}/require: must be { from, to } integers with from <= to`);
      else checkOnly(need, ["from", "to"], `${here}/require`, problems);
    }
  }
}
function checkIteration(iteration, path, problems) {
  if (!isObject(iteration)) { problems.push(`${path}: must be { over, as }`); return; }
  checkOnly(iteration, ["over", "as", "index"], path, problems);
  if (!Object.hasOwn(iteration, "over")) problems.push(`${path}: missing over`); else checkExpression(iteration.over, `${path}/over`, problems);
  checkName(iteration.as, `${path}/as`, problems);
  if (Object.hasOwn(iteration, "index")) checkName(iteration.index, `${path}/index`, problems);
}
function checkLet(bag, path, problems) {
  if (!isObject(bag)) { problems.push(`${path}: must be an object of named expressions`); return; }
  for (const [name, expression] of Object.entries(bag)) { checkName(name, `${path}/${name}`, problems); checkExpression(expression, `${path}/${name}`, problems); }
}
function checkColumns(columns, path, problems, { align }) {
  if (!Array.isArray(columns) || columns.length === 0) { problems.push(`${path}: must be a non-empty array of columns`); return; }
  columns.forEach((column, index) => {
    const here = `${path}/${index}`;
    if (!isObject(column)) { problems.push(`${here}: must be an object`); return; }
    checkOnly(column, align ? ["header", "value", "align"] : ["header", "value"], here, problems);
    if (typeof column.header !== "string") problems.push(`${here}/header: must be a string`);
    if (!Object.hasOwn(column, "value")) problems.push(`${here}: missing value`); else checkExpression(column.value, `${here}/value`, problems);
    if (align && Object.hasOwn(column, "align") && !ALIGNS.includes(column.align)) problems.push(`${here}/align: must be one of ${ALIGNS.join(", ")}`);
  });
}

/** @returns {string[]} every problem; empty when the spec is admissible. */
export function specProblems(spec) {
  const problems = [];
  if (!isObject(spec)) return ["spec: must be an object"];
  checkOnly(spec, TOP_KEYS, "spec", problems);
  if (spec.specVersion !== SPEC_VERSION) problems.push(`spec/specVersion: must be ${JSON.stringify(SPEC_VERSION)}`);
  if (!isObject(spec.records)) problems.push("spec/records: must be an object of record name to relative path");
  else {
    for (const [name, path] of Object.entries(spec.records)) {
      checkName(name, `spec/records/${name}`, problems);
      if (!isSafeRelativePath(path)) problems.push(`spec/records/${name}: must be a relative path without . or .. segments`);
    }
  }
  const outputs = new Map();
  const claimOutput = (path, where) => {
    if (!isSafeRelativePath(path)) problems.push(`${where}: must be a relative path without . or .. segments`);
    else if (outputs.has(path)) problems.push(`${where}: ${path} is already written by ${outputs.get(path)}`);
    else outputs.set(path, where);
  };

  if (Object.hasOwn(spec, "bindings")) {
    if (!isObject(spec.bindings)) problems.push("spec/bindings: must be an object");
    else for (const [name, binding] of Object.entries(spec.bindings)) { checkName(name, `spec/bindings/${name}`, problems); checkBinding(binding, `spec/bindings/${name}`, problems); }
  }

  if (Object.hasOwn(spec, "claims")) {
    if (!Array.isArray(spec.claims)) problems.push("spec/claims: must be an array");
    else spec.claims.forEach((claim, index) => {
      const here = `spec/claims/${index}`;
      if (!isObject(claim)) { problems.push(`${here}: must be an object`); return; }
      checkOnly(claim, ["id", "manuscript", "stated", "expression", "basis", "forEach", "let"], here, problems);
      for (const field of ["id", "manuscript", "stated", "expression", "basis"]) {
        if (!Object.hasOwn(claim, field)) problems.push(`${here}: missing ${field}`); else checkExpression(claim[field], `${here}/${field}`, problems);
      }
      if (Object.hasOwn(claim, "forEach")) {
        if (!Array.isArray(claim.forEach) || claim.forEach.length === 0) problems.push(`${here}/forEach: must be a non-empty array of iterations`);
        else claim.forEach.forEach((iteration, at) => checkIteration(iteration, `${here}/forEach/${at}`, problems));
      }
      if (Object.hasOwn(claim, "let")) checkLet(claim.let, `${here}/let`, problems);
    });
  }
  if (Object.hasOwn(spec, "resultsPath")) {
    claimOutput(spec.resultsPath, "spec/resultsPath");
    if (!Array.isArray(spec.claims) || spec.claims.length === 0) problems.push("spec/resultsPath: needs claims to write");
  }

  const tableIds = new Map();
  if (Object.hasOwn(spec, "tables")) {
    if (!Array.isArray(spec.tables)) problems.push("spec/tables: must be an array (a tables file path is resolved by the runner before the operations run)");
    else spec.tables.forEach((table, index) => {
      const here = `spec/tables/${index}`;
      if (!isObject(table)) { problems.push(`${here}: must be an object`); return; }
      checkOnly(table, ["id", "iterate", "let", "csv", "markdown"], here, problems);
      if (typeof table.id !== "string" || !NAME.test(table.id)) problems.push(`${here}/id: must be a name matching ${NAME}`);
      else if (tableIds.has(table.id)) problems.push(`${here}/id: duplicate table id ${table.id}`);
      else tableIds.set(table.id, table);
      if (Object.hasOwn(table, "iterate")) checkIteration(table.iterate, `${here}/iterate`, problems);
      if (Object.hasOwn(table, "let")) checkLet(table.let, `${here}/let`, problems);
      if (!Object.hasOwn(table, "csv") && !Object.hasOwn(table, "markdown")) problems.push(`${here}: needs a csv or markdown output`);
      if (Object.hasOwn(table, "csv")) {
        const csv = table.csv;
        if (!isObject(csv)) problems.push(`${here}/csv: must be an object`);
        else {
          checkOnly(csv, ["path", "columns", "crlfDigest"], `${here}/csv`, problems);
          claimOutput(csv.path, `${here}/csv/path`);
          checkColumns(csv.columns, `${here}/csv/columns`, problems, { align: false });
          if (Object.hasOwn(csv, "crlfDigest") && typeof csv.crlfDigest !== "boolean") problems.push(`${here}/csv/crlfDigest: must be a boolean`);
        }
      }
      if (Object.hasOwn(table, "markdown")) {
        const markdown = table.markdown;
        if (!isObject(markdown)) problems.push(`${here}/markdown: must be an object`);
        else {
          checkOnly(markdown, ["caption", "label", "columns"], `${here}/markdown`, problems);
          if (!Object.hasOwn(markdown, "caption")) problems.push(`${here}/markdown: missing caption`); else checkExpression(markdown.caption, `${here}/markdown/caption`, problems);
          if (Object.hasOwn(markdown, "label") && (typeof markdown.label !== "string" || !/^[A-Za-z][A-Za-z0-9:_.-]*$/u.test(markdown.label))) problems.push(`${here}/markdown/label: must be a Pandoc identifier`);
          checkColumns(markdown.columns, `${here}/markdown/columns`, problems, { align: true });
        }
      }
    });
  }

  if (Object.hasOwn(spec, "documents")) {
    if (!Array.isArray(spec.documents)) problems.push("spec/documents: must be an array");
    else spec.documents.forEach((document, index) => {
      const here = `spec/documents/${index}`;
      if (!isObject(document)) { problems.push(`${here}: must be an object`); return; }
      checkOnly(document, ["path", "blocks"], here, problems);
      claimOutput(document.path, `${here}/path`);
      if (!Array.isArray(document.blocks) || document.blocks.length === 0) { problems.push(`${here}/blocks: must be a non-empty array`); return; }
      document.blocks.forEach((block, at) => {
        const where = `${here}/blocks/${at}`;
        if (!isObject(block) || Object.keys(block).length !== 1) { problems.push(`${where}: must be an object with one of heading, paragraph, table`); return; }
        const [kind] = Object.keys(block);
        const value = block[kind];
        if (kind === "heading") {
          if (!isObject(value)) { problems.push(`${where}/heading: must be an object`); return; }
          checkOnly(value, ["level", "text", "id"], `${where}/heading`, problems);
          if (!Number.isInteger(value.level) || value.level < 1 || value.level > 6) problems.push(`${where}/heading/level: must be 1 to 6`);
          if (!Object.hasOwn(value, "text")) problems.push(`${where}/heading: missing text`); else checkExpression(value.text, `${where}/heading/text`, problems);
          if (Object.hasOwn(value, "id") && (typeof value.id !== "string" || !/^[A-Za-z][A-Za-z0-9:_.-]*$/u.test(value.id))) problems.push(`${where}/heading/id: must be a Pandoc identifier`);
        } else if (kind === "paragraph") checkExpression(value, `${where}/paragraph`, problems);
        else if (kind === "table") {
          if (typeof value !== "string") problems.push(`${where}/table: must be a table id`);
          else if (!tableIds.has(value)) problems.push(`${where}/table: no table ${value}`);
          else if (!isObject(tableIds.get(value).markdown)) problems.push(`${where}/table: table ${value} has no markdown output`);
        } else problems.push(`${where}: unknown block ${kind}`);
      });
    });
  }
  return problems;
}

/** @throws {TypeError} listing every problem. */
export function admitSpec(spec) {
  const problems = specProblems(spec);
  if (problems.length > 0) throw new TypeError(`spec is not admissible: ${problems.slice(0, 40).join("; ")}${problems.length > 40 ? `; and ${problems.length - 40} more` : ""}`);
  return spec;
}
