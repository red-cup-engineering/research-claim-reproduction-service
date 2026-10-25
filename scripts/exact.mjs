// The value model of the claim-spec language over the house exact-number service.
// A number is a Decimal: canonical decimal text that keeps its trailing zeros ("17.20" is not "17.2",
// because the text is what a claim compares and prints). Every operation is carried out on exact
// rationals by @red-cup-engineering/exact-number-data-service and written back at a stated scale;
// no binary float takes part in any sum, product, quotient or rounding, and this module holds no
// arithmetic of its own.
import { decimalOfRational, expandDecimalNotation, parseDecimal, rationalOfDecimal, truncateDecimalString } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { divide, ratAdd, ratCompare, ratFromInt, ratIsZero, ratMultiply, rationalParts } from "@red-cup-engineering/exact-number-data-service/exact-number";

const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const NEGATIVE_ZERO = /^-(0(?:\.0*)?)$/u;

/** A decimal number: canonical text only; the value is its rational, read on demand. */
export class Decimal {
  #text;
  constructor(text) {
    if (typeof text !== "string" || !DECIMAL.test(text)) throw new TypeError(`not a plain decimal: ${String(text)}`);
    this.#text = text.replace(NEGATIVE_ZERO, "$1");
    Object.freeze(this);
  }
  get text() { return this.#text; }
  get scale() { return parseDecimal(this.#text).frac.length; }
  get rational() { return rationalOfDecimal(this.#text); }
}
export const isDec = (value) => value instanceof Decimal;
export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && !isDec(value);

const LITERAL = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/u;

/** A decimal from an integer (number or bigint). */
export const decOf = (integer) => new Decimal(BigInt(integer).toString());

const atScale = (text, scale) => {
  const { negative, whole, frac } = parseDecimal(text);
  return `${negative ? "-" : ""}${whole}${scale > 0 ? `.${frac.padEnd(scale, "0")}` : ""}`;
};

/** Exact value of a JSON number literal, keeping its trailing zeros ("17.20" has scale 2). */
export function decFromLiteral(text) {
  const match = LITERAL.exec(text);
  if (match === null) throw new TypeError(`not a JSON number literal: ${text}`);
  const [, , , fraction = "", exponent] = match;
  if (exponent === undefined) return new Decimal(text);
  return new Decimal(atScale(expandDecimalNotation(text), Math.max(0, fraction.length - Number(exponent))));
}

/** A JS number read as the shortest decimal that round-trips it (what its JSON literal meant). */
export function decFromNumber(number) {
  if (!Number.isFinite(number)) throw new TypeError("numbers must be finite");
  return decFromLiteral(Number.isInteger(number) && Math.abs(number) < 1e21 ? BigInt(number).toString() : String(number));
}

/** Canonical decimal text: plain digits, the sign, and exactly `scale` fractional digits. */
export const decText = (dec) => dec.text;

const wider = (a, b) => Math.max(a.scale, b.scale);
export const decAdd = (a, b) => new Decimal(decimalOfRational(ratAdd(a.rational, b.rational), wider(a, b)));
export const decMultiply = (a, b) => new Decimal(decimalOfRational(ratMultiply(a.rational, b.rational), a.scale + b.scale));
export const decCompare = (a, b) => ratCompare(a.rational, b.rational);
export const decIsInteger = (dec) => rationalParts(dec.rational)[1] === 1n;
/** The value of an integer Decimal as a bigint. */
export const decToBigInt = (dec) => {
  if (!decIsInteger(dec)) throw new RangeError(`${dec.text} is not an integer`);
  return rationalParts(dec.rational)[0];
};

/** floor(a / b) as an integer Decimal. */
export function decFloorDivide(a, b) {
  const [n, d] = rationalParts(divide(a.rational, b.rational)); // d > 0
  return decOf(n >= 0n ? n / d : -((-n + d - 1n) / d));
}

const ROUNDING = Object.freeze({ "half-even": "half-even", "half-up": "half-away-from-zero" });

/** Round to `places` fractional digits (half-even, or half-up = ties away from zero). */
export function decRound(dec, places, mode = "half-even") {
  return new Decimal(decimalOfRational(dec.rational, places, { rounding: ROUNDING[mode] }));
}

/** 100 * numerator / denominator, rounded exactly to `places` fractional digits. */
export function decPercent(numerator, denominator, places, mode = "half-even") {
  if (ratIsZero(denominator.rational)) throw new RangeError("percent denominator is zero");
  const percent = divide(ratMultiply(numerator.rational, ratFromInt(100)), denominator.rational);
  return new Decimal(decimalOfRational(percent, places, { rounding: ROUNDING[mode] }));
}

/** Strip trailing fractional zeros, never writing an exponent. */
export const decNormalize = (dec) => new Decimal(truncateDecimalString(dec.text, dec.scale));

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
    if (value.scale === 0) {
      const whole = rationalParts(value.rational)[0];
      if (whole >= BigInt(Number.MIN_SAFE_INTEGER) && whole <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(whole);
    }
    return value.text;
  }
  if (Array.isArray(value)) return value.map(toPlain);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toPlain(entry)]));
  return value;
}

/** The text a value compares and prints as: numbers by canonical decimal text, strings as themselves. */
export function canonicalText(value) {
  if (typeof value === "string") return value;
  if (isDec(value)) return value.text;
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
