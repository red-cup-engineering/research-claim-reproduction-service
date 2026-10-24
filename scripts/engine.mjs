// Evaluation of an admitted spec: bindings, claims, table rows, and the text of CSV and Pandoc output.
// Pure: records arrive as values, text leaves as strings.
import {
  Dec, canonicalText, decAdd, decMultiply, decIsInteger, fromPlain, isDec, isObject, parseExactJson, toPlain,
} from "./exact.mjs";
import { Evaluator, resolvePointer } from "./language.mjs";
import { admitSpec } from "./spec.mjs";

const REQUEST_KEYS = ["records", "recordTexts", "spec"];
export const MAX_RECORD_TEXT_BYTES = 16 * 1024 * 1024;

/** Admit a request { records?, recordTexts?, spec } and return the spec and records as values. */
export function admitRequest(request, operationName) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) throw new TypeError(`${operationName} request must be an object with records and spec`);
  for (const key of Object.keys(request)) if (!REQUEST_KEYS.includes(key)) throw new TypeError(`request does not admit ${key}`);
  const spec = admitSpec(request.spec);
  const records = {};
  const given = request.records ?? {};
  const texts = request.recordTexts ?? {};
  if (!isObject(given) || !isObject(texts)) throw new TypeError("records and recordTexts must be objects keyed by record name");
  let bytes = 0;
  for (const [name, value] of Object.entries(given)) records[name] = fromPlain(value);
  for (const [name, text] of Object.entries(texts)) {
    if (typeof text !== "string") throw new TypeError(`recordTexts.${name} must be JSON text`);
    if (Object.hasOwn(records, name)) throw new TypeError(`record ${name} is given both as records and as recordTexts`);
    bytes += new TextEncoder().encode(text).length;
    if (bytes > MAX_RECORD_TEXT_BYTES) throw new RangeError(`recordTexts exceed ${MAX_RECORD_TEXT_BYTES} bytes`);
    try { records[name] = parseExactJson(text); } catch (error) { throw new TypeError(`recordTexts.${name} is not valid JSON: ${error.message}`); }
  }
  const missing = Object.keys(spec.records).filter((name) => !Object.hasOwn(records, name));
  if (missing.length > 0) throw new TypeError(`spec names records that were not supplied: ${missing.join(", ")}`);
  return { spec, records };
}

// ---- bindings ----------------------------------------------------------------------------------

function groupSums(elements, group, label) {
  const width = BigInt(group.width);
  const scale = new Dec(BigInt(group.scale ?? 1));
  const sums = new Map();
  const seen = new Map();
  for (const element of elements) {
    const key = resolvePointer(element, group.key, label);
    if (!isDec(key) || !decIsInteger(key)) throw new RangeError(`${label}: groupBy key must be an integer`);
    const value = resolvePointer(element, group.value, label);
    if (!isDec(value)) throw new RangeError(`${label}: groupBy value must be a number`);
    const start = (key.unscaled - (((key.unscaled % width) + width) % width));
    sums.set(start, decAdd(sums.get(start) ?? new Dec(0n), value));
    seen.set(key.unscaled, (seen.get(key.unscaled) ?? 0) + 1);
  }
  if (group.require !== undefined) {
    const problems = [];
    for (let year = BigInt(group.require.from); year <= BigInt(group.require.to); year += 1n) {
      const times = seen.get(year) ?? 0;
      if (times !== 1) problems.push(`${year} ${times === 0 ? "is missing" : `appears ${times} times`}`);
    }
    for (const year of seen.keys()) if (year < BigInt(group.require.from) || year > BigInt(group.require.to)) problems.push(`${year} is outside the required ${group.require.from} to ${group.require.to}`);
    if (problems.length > 0) throw new RangeError(`${label}: groupBy requires each key from ${group.require.from} to ${group.require.to} exactly once: ${problems.slice(0, 8).join("; ")}`);
  }
  if (sums.size === 0) return [];
  const starts = [...sums.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out = [];
  for (let start = starts[0]; start <= starts[starts.length - 1]; start += width) {
    if (!sums.has(start)) throw new RangeError(`${label}: no elements fall in the group starting at ${start}`);
    out.push(decMultiply(sums.get(start), scale));
  }
  return out;
}

function resolveBinding(evaluator, binding, name) {
  const label = `binding ${name}`;
  if (!Object.hasOwn(binding, "record")) return evaluator.evaluate(binding);
  let value = resolvePointer(evaluator.record(binding.record), binding.path ?? "", label);
  if (binding.groupBy !== undefined) {
    if (!Array.isArray(value)) throw new RangeError(`${label}: groupBy needs an array`);
    value = groupSums(value, binding.groupBy, label);
  }
  if (binding.slice !== undefined) {
    if (!Array.isArray(value)) throw new RangeError(`${label}: slice needs an array`);
    const [start, end = value.length] = binding.slice;
    if (start > end || end > value.length) throw new RangeError(`${label}: slice [${start}, ${end}) is outside an array of ${value.length}`);
    value = value.slice(start, end);
  }
  return value;
}

export function createEvaluator(spec, records, reserved = {}) {
  return new Evaluator({ records, bindings: spec.bindings ?? {}, reserved, resolveSource: resolveBinding });
}

// ---- iteration ---------------------------------------------------------------------------------

/** Scopes for the cartesian product of the iterations, then the `let` bag evaluated in order. */
function expand(evaluator, iterations, bag, label) {
  let scopes = [evaluator.root];
  for (const iteration of iterations) {
    const next = [];
    for (const scope of scopes) {
      const over = evaluator.evaluate(iteration.over, scope);
      if (!Array.isArray(over)) throw new RangeError(`${label}: forEach/iterate over needs an array`);
      over.forEach((element, position) => {
        const inner = scope.child().define(iteration.as, element);
        if (iteration.index !== undefined) inner.define(iteration.index, new Dec(BigInt(position)));
        next.push(inner);
      });
    }
    scopes = next;
  }
  return scopes.map((scope) => {
    if (bag === undefined) return scope;
    const inner = scope.child();
    for (const [name, expression] of Object.entries(bag)) inner.define(name, evaluator.evaluate(expression, inner));
    return inner;
  });
}

// ---- claims ------------------------------------------------------------------------------------

/** Claim results as values: { id, manuscript, stated, derived, agrees, basis }. */
export function evaluateClaims(spec, records) {
  const evaluator = createEvaluator(spec, records);
  const results = [];
  const ids = new Set();
  (spec.claims ?? []).forEach((claim, index) => {
    const label = `claims[${index}]`;
    for (const scope of expand(evaluator, claim.forEach ?? [], claim.let, label)) {
      const field = (name) => evaluator.evaluate(claim[name], scope);
      const id = field("id");
      const manuscript = field("manuscript");
      const basis = field("basis");
      for (const [name, value] of [["id", id], ["manuscript", manuscript], ["basis", basis]]) {
        if (typeof value !== "string" || value === "") throw new RangeError(`${label}: ${name} must evaluate to a non-empty string`);
      }
      if (ids.has(id)) throw new RangeError(`${label}: duplicate claim id ${id}`);
      ids.add(id);
      const stated = field("stated");
      const derived = field("expression");
      results.push({ id, manuscript, stated, derived, agrees: canonicalText(stated) === canonicalText(derived), basis });
    }
  });
  return results;
}

export function summarizeClaims(results) {
  const disagreed = results.filter((result) => !result.agrees).map((result) => result.id);
  return { total: results.length, agreed: results.length - disagreed.length, disagreed, ok: disagreed.length === 0 };
}

export const resultsText = (results) => `${JSON.stringify(toPlain(results), null, 2)}\n`;

// ---- tables ------------------------------------------------------------------------------------

function cell(value, label) {
  if (Array.isArray(value) || isObject(value)) throw new RangeError(`${label}: a table cell must be a scalar`);
  return value === null ? "" : canonicalText(value);
}

function tableRows(evaluator, table, label) {
  return expand(evaluator, table.iterate === undefined ? [] : [table.iterate], table.let, label);
}

/** RFC 4180 with LF line endings: quote a field holding a comma, quote, CR or LF. */
export function csvText(rows) {
  const field = (text) => (/[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
  return rows.map((row) => `${row.map(field).join(",")}\n`).join("");
}

const ALIGN_RULE = { left: "---", right: "--:", center: ":-:" };
const pipeCell = (text) => text.replaceAll("|", "\\|").replace(/\r?\n/gu, " ");

export function projectTable(evaluator, table, index) {
  const label = `tables[${index}] (${table.id})`;
  const scopes = tableRows(evaluator, table, label);
  const out = {};
  if (table.csv !== undefined) {
    const rows = [table.csv.columns.map((column) => column.header)];
    for (const scope of scopes) rows.push(table.csv.columns.map((column) => cell(evaluator.evaluate(column.value, scope), `${label} csv column ${column.header}`)));
    out.csv = csvText(rows);
  }
  if (table.markdown !== undefined) {
    const { columns, caption, label: tag = `tbl:${table.id}` } = table.markdown;
    const captionText = canonicalText(evaluator.evaluate(caption, evaluator.root));
    if (/[\r\n]/u.test(captionText)) throw new RangeError(`${label}: caption must be one line`);
    const lines = [`Table: ${captionText} {#${tag}}`, ""];
    lines.push(`| ${columns.map((column) => pipeCell(column.header)).join(" | ")} |`);
    lines.push(`|${columns.map((column) => ALIGN_RULE[column.align ?? "left"]).join("|")}|`);
    for (const scope of scopes) lines.push(`| ${columns.map((column) => pipeCell(cell(evaluator.evaluate(column.value, scope), `${label} markdown column ${column.header}`))).join(" | ")} |`);
    out.markdown = lines.join("\n");
  }
  return out;
}

export function projectDocument(evaluator, document, tables) {
  const blocks = document.blocks.map((block) => {
    const [kind] = Object.keys(block);
    const value = block[kind];
    if (kind === "heading") {
      const text = canonicalText(evaluator.evaluate(value.text, evaluator.root));
      return `${"#".repeat(value.level)} ${text}${value.id === undefined ? "" : ` {#${value.id}}`}`;
    }
    if (kind === "paragraph") return canonicalText(evaluator.evaluate(value, evaluator.root));
    return tables.get(value).markdown;
  });
  return `${blocks.join("\n\n")}\n`;
}

/** Everything the spec writes, as [{ path, text, crlf? }] in a fixed order, plus the claim results. */
export function projectAll(spec, records) {
  const results = evaluateClaims(spec, records);
  const evaluator = createEvaluator(spec, records, { claimResults: results });
  const tables = new Map();
  const files = [];
  (spec.tables ?? []).forEach((table, index) => {
    const projected = projectTable(evaluator, table, index);
    tables.set(table.id, projected);
    if (projected.csv !== undefined) files.push({ path: table.csv.path, text: projected.csv, crlfDigest: table.csv.crlfDigest === true });
  });
  if (spec.resultsPath !== undefined) files.push({ path: spec.resultsPath, text: resultsText(results), crlfDigest: false });
  for (const document of spec.documents ?? []) files.push({ path: document.path, text: projectDocument(evaluator, document, tables), crlfDigest: false });
  return { files, results };
}
