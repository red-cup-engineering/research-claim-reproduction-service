// Exact decimal arithmetic and the value model of the claim-spec language.
// A number is a Dec: a BigInt unscaled value and a non-negative decimal scale. No binary float
// takes part in any sum, product, quotient or rounding.

const TEN = 10n;
const pow10 = (n) => TEN ** BigInt(n);

export class Dec {
  constructor(unscaled, scale = 0) {
    this.unscaled = BigInt(unscaled);
    this.scale = scale;
    Object.freeze(this);
  }
}
export const isDec = (value) => value instanceof Dec;
export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && !isDec(value);

const LITERAL = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/u;

/** Exact value of a JSON number literal, keeping its trailing zeros ("17.20" has scale 2). */
export function decFromLiteral(text) {
  const match = LITERAL.exec(text);
  if (match === null) throw new TypeError(`not a JSON number literal: ${text}`);
  const [, sign, whole, fraction = "", exponent = "0"] = match;
  let unscaled = BigInt(whole + fraction);
  let scale = fraction.length - Number(exponent);
  if (scale < 0) {
    unscaled *= pow10(-scale);
    scale = 0;
  }
  return new Dec(sign === "-" ? -unscaled : unscaled, scale);
}

/** A JS number read as the shortest decimal that round-trips it (what its JSON literal meant). */
export function decFromNumber(number) {
  if (!Number.isFinite(number)) throw new TypeError("numbers must be finite");
  return decFromLiteral(Number.isInteger(number) && Math.abs(number) < 1e21 ? BigInt(number).toString() : String(number));
}

const digits = (big) => (big < 0n ? -big : big).toString();

/** Canonical decimal text: plain digits, the sign, and exactly `scale` fractional digits. */
export function decText(dec) {
  const negative = dec.unscaled < 0n;
  let body = digits(dec.unscaled);
  if (dec.scale > 0) {
    body = body.padStart(dec.scale + 1, "0");
    body = `${body.slice(0, -dec.scale)}.${body.slice(-dec.scale)}`;
  }
  return negative ? `-${body}` : body;
}

const align = (a, b) => {
  const scale = Math.max(a.scale, b.scale);
  return [a.unscaled * pow10(scale - a.scale), b.unscaled * pow10(scale - b.scale), scale];
};
export const decAdd = (a, b) => { const [x, y, scale] = align(a, b); return new Dec(x + y, scale); };
export const decMultiply = (a, b) => new Dec(a.unscaled * b.unscaled, a.scale + b.scale);
export const decCompare = (a, b) => { const [x, y] = align(a, b); return x < y ? -1 : x > y ? 1 : 0; };
export const decIsInteger = (dec) => dec.unscaled % pow10(dec.scale) === 0n;

/** Quotient of integers n/d (d != 0) rounded to an integer. Modes: half-even, half-up (ties away from zero). */
export function roundDivide(n, d, mode) {
  if (d === 0n) throw new RangeError("division by zero");
  if (d < 0n) { n = -n; d = -d; }
  const negative = n < 0n;
  const a = negative ? -n : n;
  let q = a / d;
  const twice = 2n * (a % d);
  if (twice > d || (twice === d && (mode === "half-up" || q % 2n === 1n))) q += 1n;
  return negative ? -q : q;
}

export function floorDivide(n, d) {
  if (d === 0n) throw new RangeError("division by zero");
  if (d < 0n) { n = -n; d = -d; }
  const q = n / d;
  return n % d !== 0n && n < 0n ? q - 1n : q;
}

/** floor(a / b) as an integer Dec. */
export function decFloorDivide(a, b) {
  return new Dec(floorDivide(a.unscaled * pow10(b.scale), b.unscaled * pow10(a.scale)), 0);
}

/** Round to `places` fractional digits. */
export function decRound(dec, places, mode = "half-even") {
  if (places >= dec.scale) return new Dec(dec.unscaled * pow10(places - dec.scale), places);
  return new Dec(roundDivide(dec.unscaled, pow10(dec.scale - places), mode), places);
}

/** 100 * numerator / denominator, rounded exactly to `places` fractional digits. */
export function decPercent(numerator, denominator, places, mode = "half-even") {
  if (denominator.unscaled === 0n) throw new RangeError("percent denominator is zero");
  const top = numerator.unscaled * 100n * pow10(denominator.scale + places);
  const bottom = denominator.unscaled * pow10(numerator.scale);
  return new Dec(roundDivide(top, bottom, mode), places);
}

/** Strip trailing fractional zeros, never writing an exponent (Python's Decimal.normalize would). */
export function decNormalize(dec) {
  let { unscaled, scale } = dec;
  while (scale > 0 && unscaled % TEN === 0n) { unscaled /= TEN; scale -= 1; }
  return new Dec(unscaled, scale);
}

export function groupThousands(text) {
  const negative = text.startsWith("-");
  const [whole, fraction] = (negative ? text.slice(1) : text).split(".");
  const grouped = whole.replace(/\B(?=(?:[0-9]{3})+$)/gu, ",");
  return `${negative ? "-" : ""}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}

// ---- value model <-> JSON ----------------------------------------------------------------------

/** Plain JSON (numbers are doubles) into the value model. */
export function fromPlain(value) {
  if (typeof value === "number") return decFromNumber(value);
  if (Array.isArray(value)) return value.map(fromPlain);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, fromPlain(entry)]));
  return value;
}

/** Parse JSON text into the value model keeping every number literal exact (needs JSON.parse source access). */
export function parseExactJson(text) {
  return JSON.parse(text, function reviver(key, value, context) {
    if (typeof value === "number") return decFromLiteral(context.source);
    return value;
  });
}

/** The value model as plain JSON: integers are numbers, decimals with a fractional part are strings (they keep their digits). */
export function toPlain(value) {
  if (isDec(value)) {
    if (value.scale === 0 && value.unscaled >= BigInt(Number.MIN_SAFE_INTEGER) && value.unscaled <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value.unscaled);
    return decText(value);
  }
  if (Array.isArray(value)) return value.map(toPlain);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toPlain(entry)]));
  return value;
}

/** The text a value compares and prints as: numbers by canonical decimal text, strings as themselves. */
export function canonicalText(value) {
  if (typeof value === "string") return value;
  if (isDec(value)) return decText(value);
  if (value === null) return "null";
  if (typeof value === "boolean") return String(value);
  return JSON.stringify(toPlain(value));
}

export function valuesEqual(a, b) {
  if (isDec(a) && isDec(b)) return decCompare(a, b) === 0;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((entry, index) => valuesEqual(entry, b[index]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && valuesEqual(a[key], b[key]));
  }
  return a === b;
}
