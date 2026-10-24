import test from "node:test";
import assert from "node:assert/strict";
import { reproduceStatedClaims } from "../scripts/reproduce-stated-claims.mjs";
import { claimOf, specOf } from "./helpers.mjs";

const RECORD = {
  xs: [1, 2, 3, 4],
  prices: [0.1, 0.2],
  docs: [{ id: "A-1", state: "enacted", tags: ["a", "b"] }, { id: "B-2", state: "failed" }, { id: "B-3", state: "enacted", tags: [] }],
  years: [{ year: 1800, v: 1 }, { year: 1801, v: 2 }, { year: 1810, v: 5 }, { year: 1811, v: 7 }],
};
const records = { r: "r.json" };
const run = (claims, extra = {}, input = { records: { r: RECORD } }) => reproduceStatedClaims({ ...input, spec: specOf(claims, { records, ...extra }) });
const one = (expression, stated, extra) => run([claimOf(expression, stated)], extra).results[0];
const agrees = (expression, stated, extra) => one(expression, stated, extra).agrees;
const r = (path) => ({ pointer: { record: "r", path } });

test("an agreeing claim and a disagreeing claim are results, not refusals", () => {
  const out = run([claimOf({ sum: r("/xs") }, 10, "ok"), claimOf({ sum: r("/xs") }, 11, "bad")]);
  assert.deepEqual(out.results.map((x) => [x.id, x.stated, x.derived, x.agrees]), [["ok", 10, 10, true], ["bad", 11, 10, false]]);
  assert.deepEqual([out.total, out.agreed, out.disagreed, out.ok], [2, 1, ["bad"], false]);
});

test("decimal sums are exact where binary floats are not", () => {
  const result = one({ sum: r("/prices") }, "0.3");
  assert.equal(result.derived, "0.3");
  assert.equal(result.agrees, true);
});

test("recordTexts carry literals the double cannot", () => {
  const out = run([claimOf({ sum: r("/big") }, "9007199254740994")], {}, { recordTexts: { r: '{"big":[9007199254740993,1]}' } });
  assert.equal(out.results[0].derived, "9007199254740994");
  assert.equal(out.ok, true);
  assert.throws(() => run([claimOf(1, 1)], {}, { records: { r: {} }, recordTexts: { r: "{}" } }), /both/u);
  assert.throws(() => run([claimOf(1, 1)], {}, { recordTexts: { r: "{" } }), /not valid JSON/u);
});

test("arithmetic operators", () => {
  assert.equal(agrees({ add: [1, 2, { multiply: [2, 3] }] }, 9), true);
  assert.equal(agrees({ subtract: [1, 3] }, -2), true);
  assert.equal(agrees({ floorDivide: { numerator: -7, denominator: 2 } }, -4), true);
  assert.equal(agrees({ percent: { numerator: 1, denominator: 8, places: 0, rounding: "half-up" } }, 13), true);
  assert.equal(agrees({ percent: { numerator: 1, denominator: 8, places: 0 } }, 12), true);
  assert.throws(() => one({ floorDivide: { numerator: 1, denominator: 0 } }, 0), RangeError);
  assert.throws(() => one({ percent: { numerator: 1, denominator: { subtract: [1, 1] }, places: 2 } }, 0), /zero/u);
  assert.throws(() => one({ add: ["x", 1] }, 0), /number/u);
});

test("percent keeps trailing zeros and agrees by text, as a string", () => {
  const result = one({ percent: { numerator: 43, denominator: 250, places: 2 } }, "17.20");
  assert.equal(result.derived, "17.20");
  assert.equal(result.agrees, true);
  assert.equal(agrees({ percent: { numerator: 43, denominator: 250, places: 2 } }, "17.2"), false);
});

test("arrays: slice, substitute, concat, range, map, count, get", () => {
  assert.equal(agrees({ sum: { slice: { array: r("/xs"), start: 1, end: 3 } } }, 5), true);
  assert.equal(agrees({ sum: { slice: { array: r("/xs"), start: 2 } } }, 7), true);
  assert.equal(agrees({ sum: { substitute: { array: r("/xs"), index: 0, value: 10 } } }, 19), true);
  assert.equal(agrees({ sum: { concat: [r("/xs"), [100]] } }, 110), true);
  assert.equal(agrees({ sum: { range: { start: 5, step: 5, count: 3 } } }, 30), true);
  assert.equal(agrees({ sum: { map: { over: r("/xs"), as: "x", index: "i", to: { multiply: [{ ref: "x" }, { ref: "i" }] } } } }, 20), true);
  assert.equal(agrees({ get: { from: r("/xs"), key: 2 } }, 3), true);
  assert.equal(agrees({ count: { array: r("/xs") } }, 4), true);
  assert.equal(agrees({ sum: { map: { over: r("/docs"), as: "d", to: { count: { array: { get: { from: { ref: "d" }, key: "tags", default: { literal: [] } } } } } } } }, 2), true);
  assert.throws(() => one({ slice: { array: r("/xs"), start: 3, end: 9 } }, 0), /outside/u);
  assert.throws(() => one({ substitute: { array: r("/xs"), index: 4, value: 1 } }, 0), /outside/u);
  assert.throws(() => one({ get: { from: r("/xs"), key: 9 } }, 0), /no 9/u);
  assert.throws(() => one({ range: { start: 0, step: 1, count: 1000000 } }, 0), /exceeds/u);
});

test("where: any, all, find, count with startsWith, equals, notEquals", () => {
  assert.equal(agrees({ any: { array: r("/docs"), where: { id: { startsWith: "B" }, state: { notEquals: "enacted" } } } }, true), true);
  assert.equal(agrees({ any: { array: r("/docs"), where: { id: { startsWith: "C" } } } }, false), true);
  assert.equal(agrees({ all: { array: r("/docs"), where: { id: { notEquals: "Z" } } } }, true), true);
  assert.equal(agrees({ count: { array: r("/docs"), where: { state: { equals: "enacted" } } } }, 2), true);
  assert.equal(agrees({ get: { from: { find: { array: r("/docs"), where: { id: { equals: "B-3" } } } }, key: "state" } }, "enacted"), true);
  assert.throws(() => one({ find: { array: r("/docs"), where: { state: { equals: "enacted" } } } }, 1), /exactly one/u);
  assert.throws(() => one({ find: { array: r("/docs"), where: { id: { equals: "none" } } } }, 1), /exactly one/u);
  assert.throws(() => one({ any: { array: r("/docs"), where: { nope: { equals: 1 } } } }, true), RangeError);
});

test("format, text, substring, normalize, if, equals", () => {
  assert.equal(agrees({ format: { value: 1234567, group: true } }, "1,234,567"), true);
  assert.equal(agrees({ format: { value: { literal: 2.5 }, places: 3 } }, "2.500"), true);
  assert.equal(agrees({ format: { value: true, booleans: ["Yes", "No"] } }, "Yes"), true);
  assert.equal(agrees({ text: ["a", 1, true, { literal: 1.5 }] }, "a1true1.5"), true);
  assert.equal(agrees({ substring: { value: 1799, start: 2 } }, "99"), true);
  assert.equal(agrees({ normalize: { percent: { numerator: 1, denominator: 8, places: 4 } } }, "12.5"), true);
  assert.equal(agrees({ if: { cond: { equals: [{ literal: 2.0 }, 2] }, then: "same", else: "different" } }, "same"), true);
  assert.throws(() => one({ format: { value: "x", places: 1 } }, "x"), /numbers/u);
  assert.throws(() => one({ if: { cond: 1, then: 1, else: 2 } }, 1), /boolean/u);
  assert.throws(() => one({ text: [[1]] }, ""), /scalar/u);
});

test("bindings: sources with slice and groupBy, expressions, lazy order, cycles", () => {
  const bindings = {
    tail: { record: "r", path: "/xs", slice: [2] },
    middle: { record: "r", path: "/xs", slice: [1, 3] },
    decades: { record: "r", path: "/years", groupBy: { key: "/year", value: "/v", width: 10, scale: 1000 } },
    total: { sum: { ref: "decades" } },
    whole: { record: "r" },
  };
  assert.equal(agrees({ sum: { ref: "tail" } }, 7, { bindings }), true);
  assert.equal(agrees({ sum: { ref: "middle" } }, 5, { bindings }), true);
  assert.equal(agrees({ ref: "total" }, 15000, { bindings }), true);
  assert.equal(agrees({ count: { array: { ref: "decades" } } }, 2, { bindings }), true);
  assert.equal(agrees({ count: { array: { get: { from: { ref: "whole" }, key: "xs" } } } }, 4, { bindings }), true);
  assert.throws(() => one({ ref: "a" }, 1, { bindings: { a: { ref: "b" }, b: { ref: "a" } } }), /depends on itself/u);
  assert.throws(() => one({ ref: "nope" }, 1), /no such variable/u);
  assert.throws(() => one({ sum: { ref: "bad" } }, 1, { bindings: { bad: { record: "r", path: "/xs", slice: [0, 9] } } }), /outside/u);
  assert.throws(() => one({ pointer: { record: "ghost", path: "" } }, 1), /unknown record/u);
  assert.throws(() => one({ pointer: { record: "r", path: "/missing" } }, 1), /does not resolve/u);
});

test("groupBy.require refuses gaps and duplicates; interior empty groups are refused", () => {
  const group = (require) => ({ g: { record: "r", path: "/years", groupBy: { key: "/year", value: "/v", width: 10, require } } });
  assert.throws(() => one({ ref: "g" }, 1, { bindings: group({ from: 1800, to: 1811 }) }), /1802 is missing/u);
  assert.throws(() => one({ ref: "g" }, 1, { bindings: group({ from: 1800, to: 1801 }) }), /outside/u);
  const doubled = { r: { years: [{ year: 1800, v: 1 }, { year: 1800, v: 1 }] } };
  assert.throws(() => run([claimOf({ ref: "g" }, 1)], { bindings: group({ from: 1800, to: 1800 }) }, { records: doubled }), /appears 2 times/u);
  const gap = { r: { years: [{ year: 1800, v: 1 }, { year: 1820, v: 1 }] } };
  assert.throws(() => run([claimOf({ ref: "g" }, 1)], { bindings: { g: { record: "r", path: "/years", groupBy: { key: "/year", value: "/v", width: 10 } } } }, { records: gap }), /no elements fall/u);
});

test("forEach and let expand claims in nested order", () => {
  const out = run([{
    id: { text: ["c-", { ref: "x" }, "-", { ref: "y" }] }, manuscript: "m", stated: { ref: "product" }, expression: { multiply: [{ ref: "x" }, { ref: "y" }] }, basis: "b",
    forEach: [{ over: r("/xs"), as: "x" }, { over: { literal: [10, 20] }, as: "y", index: "k" }],
    let: { product: { multiply: [{ ref: "y" }, { ref: "x" }] } },
  }]);
  assert.equal(out.total, 8);
  assert.deepEqual(out.results.slice(0, 3).map((x) => x.id), ["c-1-10", "c-1-20", "c-2-10"]);
  assert.equal(out.ok, true);
});

test("duplicate claim ids, non-string ids and the step budget are refused", () => {
  assert.throws(() => run([claimOf(1, 1), claimOf(1, 1)]), /duplicate claim id/u);
  assert.throws(() => run([{ ...claimOf(1, 1), id: 5 }]), /non-empty string/u);
  const deep = { sum: { map: { over: { range: { start: 0, step: 1, count: 90000 } }, as: "a", to: { sum: { map: { over: { range: { start: 0, step: 1, count: 90000 } }, as: "b", to: 1 } } } } } };
  assert.throws(() => one(deep, 0), /steps/u);
});
