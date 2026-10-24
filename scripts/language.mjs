// The claim-spec expression language: a static checker (every problem listed with its path) and an
// evaluator over exact decimals. Pure: no clock, filesystem, network or randomness.
import {
  Dec, canonicalText, decAdd, decFloorDivide, decFromNumber, decIsInteger, decMultiply, decNormalize, decPercent,
  decRound, decText, fromPlain, groupThousands, isDec, isObject, valuesEqual,
} from "./exact.mjs";

export const NAME = /^[A-Za-z][A-Za-z0-9_-]*$/u;
export const RESERVED_NAMES = Object.freeze(["claimResults"]);
export const ROUNDING = Object.freeze(["half-even", "half-up"]);
export const PREDICATES = Object.freeze(["startsWith", "equals", "notEquals"]);
export const LIMITS = Object.freeze({ steps: 1_000_000, rangeCount: 100_000, places: 30 });

const OPERATORS = Object.freeze([
  "literal", "ref", "pointer", "get", "sum", "add", "multiply", "subtract", "floorDivide", "percent", "count",
  "slice", "substitute", "concat", "map", "range", "any", "all", "find", "format", "normalize", "text",
  "substring", "equals", "if",
]);
export const OPERATOR_NAMES = OPERATORS;

// ---- static check ------------------------------------------------------------------------------

const isInteger = (value) => Number.isInteger(value);

/** Append every problem in `expression` (at `path`) to `problems`. */
export function checkExpression(expression, path, problems) {
  if (expression === null || ["string", "number", "boolean"].includes(typeof expression)) return;
  if (Array.isArray(expression)) { expression.forEach((entry, index) => checkExpression(entry, `${path}/${index}`, problems)); return; }
  if (!isObject(expression)) { problems.push(`${path}: not a JSON value`); return; }
  const keys = Object.keys(expression);
  if (keys.length !== 1) { problems.push(`${path}: an expression object has exactly one operator key, found ${keys.length === 0 ? "none" : keys.join(", ")}`); return; }
  const [operator] = keys;
  const args = expression[operator];
  const here = `${path}/${operator}`;
  const sub = (value, at) => checkExpression(value, `${here}${at}`, problems);
  const fields = (required, optional = []) => {
    if (!isObject(args)) { problems.push(`${here}: must be an object with ${required.join(", ")}`); return false; }
    for (const key of required) if (!Object.hasOwn(args, key)) problems.push(`${here}: missing ${key}`);
    for (const key of Object.keys(args)) if (!required.includes(key) && !optional.includes(key)) problems.push(`${here}: does not admit ${key}`);
    return true;
  };
  const list = (min, max = Infinity) => {
    if (!Array.isArray(args) || args.length < min || args.length > max) { problems.push(`${here}: must be an array of ${min === max ? min : `at least ${min}`} expressions`); return false; }
    args.forEach((entry, index) => sub(entry, `/${index}`));
    return true;
  };
  const places = (value, at) => { if (!isInteger(value) || value < 0 || value > LIMITS.places) problems.push(`${here}${at}: must be an integer from 0 to ${LIMITS.places}`); };
  const rounding = (value, at) => { if (!ROUNDING.includes(value)) problems.push(`${here}${at}: must be one of ${ROUNDING.join(", ")}`); };
  const name = (value, at) => { if (typeof value !== "string" || !NAME.test(value) || RESERVED_NAMES.includes(value)) problems.push(`${here}${at}: must be a name matching ${NAME} and not reserved`); };

  switch (operator) {
    case "literal": return;
    case "ref": if (typeof args !== "string" || args === "") problems.push(`${here}: must be a name`); return;
    case "pointer":
      if (fields(["record", "path"])) {
        if (typeof args.record !== "string" || args.record === "") problems.push(`${here}/record: must be a record name`);
        if (typeof args.path !== "string") problems.push(`${here}/path: must be a JSON Pointer string`);
      }
      return;
    case "get": if (fields(["from", "key"], ["default"])) { sub(args.from, "/from"); sub(args.key, "/key"); if (Object.hasOwn(args, "default")) sub(args.default, "/default"); } return;
    case "sum": case "normalize": sub(args, ""); return;
    case "add": case "multiply": list(1); return;
    case "concat": list(1); return;
    case "text": list(1); return;
    case "subtract": case "equals": list(2, 2); return;
    case "floorDivide": if (fields(["numerator", "denominator"])) { sub(args.numerator, "/numerator"); sub(args.denominator, "/denominator"); } return;
    case "percent":
      if (fields(["numerator", "denominator", "places"], ["rounding"])) {
        sub(args.numerator, "/numerator"); sub(args.denominator, "/denominator"); places(args.places, "/places");
        if (Object.hasOwn(args, "rounding")) rounding(args.rounding, "/rounding");
      }
      return;
    case "count": if (fields(["array"], ["where"])) { sub(args.array, "/array"); if (Object.hasOwn(args, "where")) checkWhere(args.where, `${here}/where`, problems); } return;
    case "any": case "all": case "find": if (fields(["array", "where"])) { sub(args.array, "/array"); checkWhere(args.where, `${here}/where`, problems); } return;
    case "slice": if (fields(["array", "start"], ["end"])) { sub(args.array, "/array"); sub(args.start, "/start"); if (Object.hasOwn(args, "end")) sub(args.end, "/end"); } return;
    case "substitute": if (fields(["array", "index", "value"])) { sub(args.array, "/array"); sub(args.index, "/index"); sub(args.value, "/value"); } return;
    case "map":
      if (fields(["over", "as", "to"], ["index"])) {
        sub(args.over, "/over"); name(args.as, "/as"); sub(args.to, "/to");
        if (Object.hasOwn(args, "index")) name(args.index, "/index");
      }
      return;
    case "range": if (fields(["start", "step", "count"])) { sub(args.start, "/start"); sub(args.step, "/step"); sub(args.count, "/count"); } return;
    case "format":
      if (fields(["value"], ["places", "rounding", "group", "booleans"])) {
        sub(args.value, "/value");
        if (Object.hasOwn(args, "places")) places(args.places, "/places");
        if (Object.hasOwn(args, "rounding")) rounding(args.rounding, "/rounding");
        if (Object.hasOwn(args, "group") && typeof args.group !== "boolean") problems.push(`${here}/group: must be a boolean`);
        if (Object.hasOwn(args, "booleans") && !(Array.isArray(args.booleans) && args.booleans.length === 2 && args.booleans.every((label) => typeof label === "string"))) problems.push(`${here}/booleans: must be [trueLabel, falseLabel]`);
      }
      return;
    case "substring": if (fields(["value", "start"], ["end"])) { sub(args.value, "/value"); sub(args.start, "/start"); if (Object.hasOwn(args, "end")) sub(args.end, "/end"); } return;
    case "if": if (fields(["cond", "then", "else"])) { sub(args.cond, "/cond"); sub(args.then, "/then"); sub(args.else, "/else"); } return;
    default: problems.push(`${here}: unknown operator ${operator}; expected one of ${OPERATORS.join(", ")}`);
  }
}

export function checkWhere(where, path, problems) {
  if (!isObject(where) || Object.keys(where).length === 0) { problems.push(`${path}: must be a non-empty object of field predicates`); return; }
  for (const [field, predicate] of Object.entries(where)) {
    if (field === "") problems.push(`${path}: empty field name`);
    if (!isObject(predicate) || Object.keys(predicate).length === 0) { problems.push(`${path}/${field}: must be an object with ${PREDICATES.join(", ")}`); continue; }
    for (const [kind, operand] of Object.entries(predicate)) {
      if (!PREDICATES.includes(kind)) problems.push(`${path}/${field}: unknown predicate ${kind}`);
      else checkExpression(operand, `${path}/${field}/${kind}`, problems);
    }
  }
}

// ---- JSON Pointer ------------------------------------------------------------------------------

export function pointerSteps(pointer) {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new TypeError(`JSON Pointer must be empty or start with /: ${JSON.stringify(pointer)}`);
  return pointer.slice(1).split("/").map((step) => step.replace(/~1/gu, "/").replace(/~0/gu, "~"));
}

/** Resolve a JSON Pointer in a model value; throws RangeError at the first missing step. */
export function resolvePointer(value, pointer, label) {
  let current = value;
  for (const step of pointerSteps(pointer)) {
    if (Array.isArray(current) && /^(0|[1-9][0-9]*)$/u.test(step) && Number(step) < current.length) current = current[Number(step)];
    else if (isObject(current) && Object.hasOwn(current, step)) current = current[step];
    else throw new RangeError(`${label}: ${JSON.stringify(pointer)} does not resolve (no ${JSON.stringify(step)})`);
  }
  return current;
}

// ---- evaluation --------------------------------------------------------------------------------

export class Scope {
  constructor(parent = null) { this.parent = parent; this.vars = new Map(); }
  child() { return new Scope(this); }
  define(name, value) { this.vars.set(name, value); return this; }
  lookup(name) {
    for (let scope = this; scope !== null; scope = scope.parent) if (scope.vars.has(name)) return { found: true, value: scope.vars.get(name) };
    return { found: false };
  }
}

/**
 * An evaluation context: the records (value model), the named bindings, and the reserved names
 * available to the caller (claimResults for tables). Bindings are lazy, memoized and cycle-checked.
 */
export class Evaluator {
  constructor({ records, bindings = {}, reserved = {}, resolveSource }) {
    this.records = records;
    this.bindingSpecs = bindings;
    this.reserved = reserved;
    this.resolveSource = resolveSource;
    this.memo = new Map();
    this.active = new Set();
    this.steps = 0;
    this.root = new Scope();
  }

  record(name) {
    if (!Object.hasOwn(this.records, name)) throw new RangeError(`unknown record ${JSON.stringify(name)}; the spec names ${Object.keys(this.records).join(", ") || "none"}`);
    return this.records[name];
  }

  binding(name) {
    if (this.memo.has(name)) return this.memo.get(name);
    if (this.active.has(name)) throw new RangeError(`binding ${name} depends on itself`);
    this.active.add(name);
    try {
      const value = this.resolveSource(this, this.bindingSpecs[name], name);
      this.memo.set(name, value);
      return value;
    } finally { this.active.delete(name); }
  }

  /** Spend `n` units of the budget: one per expression evaluated and one per array element built or copied. */
  charge(n = 1) {
    this.steps += n;
    if (this.steps > LIMITS.steps) throw new RangeError(`evaluation exceeded ${LIMITS.steps} steps`);
  }

  evaluate(expression, scope = this.root) {
    this.charge();
    if (typeof expression === "number") return decFromNumber(expression);
    if (expression === null || typeof expression === "string" || typeof expression === "boolean") return expression;
    if (Array.isArray(expression)) return expression.map((entry) => this.evaluate(entry, scope));
    const [operator] = Object.keys(expression);
    return this.apply(operator, expression[operator], scope);
  }

  number(value, what) {
    if (!isDec(value)) throw new RangeError(`${what} must be a number`);
    return value;
  }
  integer(value, what) {
    this.number(value, what);
    if (!decIsInteger(value)) throw new RangeError(`${what} must be an integer`);
    return value;
  }
  index(value, what) {
    this.integer(value, what);
    if (value.unscaled < 0n || value.unscaled > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${what} must be a non-negative integer`);
    return Number(value.unscaled);
  }
  array(value, what) {
    if (!Array.isArray(value)) throw new RangeError(`${what} must be an array`);
    return value;
  }
  text(value, what) {
    if (Array.isArray(value) || isObject(value)) throw new RangeError(`${what} must be a scalar`);
    return canonicalText(value);
  }

  matches(element, where, scope, label) {
    if (!isObject(element)) throw new RangeError(`${label}: where needs object elements`);
    for (const [field, predicate] of Object.entries(where)) {
      const value = field.startsWith("/") ? resolvePointer(element, field, label) : resolvePointer(element, `/${field.replace(/~/gu, "~0").replace(/\//gu, "~1")}`, label);
      for (const [kind, operand] of Object.entries(predicate)) {
        const expected = this.evaluate(operand, scope);
        if (kind === "startsWith") {
          if (typeof value !== "string" || typeof expected !== "string") throw new RangeError(`${label}: startsWith on ${field} needs strings`);
          if (!value.startsWith(expected)) return false;
        } else if (kind === "equals") { if (!valuesEqual(value, expected)) return false; }
        else if (valuesEqual(value, expected)) return false;
      }
    }
    return true;
  }

  apply(operator, args, scope) {
    const ev = (expression) => this.evaluate(expression, scope);
    const label = operator;
    switch (operator) {
      case "literal": return fromPlain(args);
      case "ref": {
        const local = scope.lookup(args);
        if (local.found) return local.value;
        if (Object.hasOwn(this.bindingSpecs, args)) return this.binding(args);
        if (Object.hasOwn(this.reserved, args)) return this.reserved[args];
        throw new RangeError(`ref ${args}: no such variable or binding`);
      }
      case "pointer": return resolvePointer(this.record(args.record), args.path, `pointer ${args.record}`);
      case "get": {
        const from = ev(args.from);
        const key = ev(args.key);
        const fallback = () => {
          if (Object.hasOwn(args, "default")) return ev(args.default);
          throw new RangeError(`get: no ${canonicalText(key)}`);
        };
        if (Array.isArray(from)) {
          const at = this.index(key, "get key");
          return at < from.length ? from[at] : fallback();
        }
        if (isObject(from)) {
          if (typeof key !== "string") throw new RangeError("get: an object is read by a string key");
          return Object.hasOwn(from, key) ? from[key] : fallback();
        }
        throw new RangeError("get: from must be an array or an object");
      }
      case "sum": return this.array(ev(args), "sum argument").reduce((total, entry) => decAdd(total, this.number(entry, "sum element")), new Dec(0n));
      case "add": return args.map(ev).reduce((total, entry) => decAdd(total, this.number(entry, "add operand")), new Dec(0n));
      case "multiply": return args.map(ev).reduce((total, entry) => decMultiply(total, this.number(entry, "multiply operand")), new Dec(1n));
      case "subtract": {
        const [a, b] = args.map(ev);
        return decAdd(this.number(a, "subtract operand"), new Dec(-this.number(b, "subtract operand").unscaled, b.scale));
      }
      case "floorDivide": {
        const numerator = this.number(ev(args.numerator), "floorDivide numerator");
        const denominator = this.number(ev(args.denominator), "floorDivide denominator");
        return decFloorDivide(numerator, denominator);
      }
      case "percent":
        return decPercent(this.number(ev(args.numerator), "percent numerator"), this.number(ev(args.denominator), "percent denominator"), args.places, args.rounding ?? "half-even");
      case "count": {
        const array = this.array(ev(args.array), "count array");
        const kept = args.where === undefined ? array.length : array.filter((element) => this.matches(element, args.where, scope, label)).length;
        return new Dec(BigInt(kept));
      }
      case "slice": {
        const array = this.array(ev(args.array), "slice array");
        const start = this.index(ev(args.start), "slice start");
        const end = args.end === undefined ? array.length : this.index(ev(args.end), "slice end");
        if (start > end || end > array.length) throw new RangeError(`slice [${start}, ${end}) is outside an array of ${array.length}`);
        this.charge(end - start);
        return array.slice(start, end);
      }
      case "substitute": {
        const array = this.array(ev(args.array), "substitute array");
        const at = this.index(ev(args.index), "substitute index");
        if (at >= array.length) throw new RangeError(`substitute index ${at} is outside an array of ${array.length}`);
        this.charge(array.length);
        const copy = [...array];
        copy[at] = ev(args.value);
        return copy;
      }
      case "concat": { const parts = args.map((entry) => this.array(ev(entry), "concat part")); this.charge(parts.reduce((n, part) => n + part.length, 0)); return parts.flat(); }
      case "map": {
        const over = this.array(ev(args.over), "map over");
        this.charge(over.length);
        return over.map((element, position) => {
          const inner = scope.child().define(args.as, element);
          if (args.index !== undefined) inner.define(args.index, new Dec(BigInt(position)));
          return this.evaluate(args.to, inner);
        });
      }
      case "range": {
        const start = this.integer(ev(args.start), "range start");
        const step = this.integer(ev(args.step), "range step");
        const count = this.index(ev(args.count), "range count");
        if (count > LIMITS.rangeCount) throw new RangeError(`range count exceeds ${LIMITS.rangeCount}`);
        this.charge(count);
        return Array.from({ length: count }, (_, position) => decAdd(start, decMultiply(step, new Dec(BigInt(position)))));
      }
      case "any": case "all": case "find": {
        const array = this.array(ev(args.array), `${operator} array`);
        const hits = array.filter((element) => this.matches(element, args.where, scope, label));
        if (operator === "any") return hits.length > 0;
        if (operator === "all") return hits.length === array.length;
        if (hits.length !== 1) throw new RangeError(`find: ${hits.length} elements match, exactly one is required`);
        return hits[0];
      }
      case "format": return this.format(ev(args.value), args);
      case "normalize": return decNormalize(this.number(ev(args), "normalize operand"));
      case "text": return args.map((entry) => this.text(ev(entry), "text part")).join("");
      case "substring": {
        const characters = Array.from(this.text(ev(args.value), "substring value"));
        const start = this.index(ev(args.start), "substring start");
        const end = args.end === undefined ? characters.length : this.index(ev(args.end), "substring end");
        if (start > end || end > characters.length) throw new RangeError(`substring [${start}, ${end}) is outside a string of ${characters.length}`);
        return characters.slice(start, end).join("");
      }
      case "equals": { const [a, b] = args.map(ev); return valuesEqual(a, b); }
      case "if": {
        const condition = ev(args.cond);
        if (typeof condition !== "boolean") throw new RangeError("if: cond must be a boolean");
        return ev(condition ? args.then : args.else);
      }
      default: throw new TypeError(`unknown operator ${operator}`);
    }
  }

  format(value, options) {
    if (typeof value === "boolean") {
      if (options.places !== undefined || options.group === true) throw new RangeError("format: places and group apply to numbers");
      return options.booleans === undefined ? String(value) : options.booleans[value ? 0 : 1];
    }
    if (typeof value === "string") {
      if (options.places !== undefined || options.group === true) throw new RangeError("format: places and group apply to numbers");
      return value;
    }
    if (!isDec(value)) throw new RangeError("format: value must be a number, string or boolean");
    const rounded = options.places === undefined ? value : decRound(value, options.places, options.rounding ?? "half-even");
    const rendered = decText(rounded);
    return options.group === true ? groupThousands(rendered) : rendered;
  }
}
