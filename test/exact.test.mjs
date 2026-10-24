import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalText, decAdd, decFloorDivide, decFromLiteral, decFromNumber, decNormalize, decPercent, decRound, decText,
  groupThousands, parseExactJson, toPlain, valuesEqual,
} from "../scripts/exact.mjs";

const d = (text) => decFromLiteral(text);

test("literals keep their digits and scale", () => {
  assert.equal(decText(d("17.20")), "17.20");
  assert.equal(decText(d("-0.05")), "-0.05");
  assert.equal(decText(d("1.5e3")), "1500");
  assert.equal(decText(d("25e-2")), "0.25");
  assert.equal(decText(decFromNumber(0.1)), "0.1");
  assert.equal(decText(decFromNumber(1e21)), "1000000000000000000000");
  assert.throws(() => decFromLiteral("1."), TypeError);
});

test("percent rounds exactly: half-even and half-up on ties, positive and negative", () => {
  assert.equal(decText(decPercent(d("1"), d("8"), 0, "half-even")), "12");
  assert.equal(decText(decPercent(d("1"), d("8"), 0, "half-up")), "13");
  assert.equal(decText(decPercent(d("3"), d("8"), 0, "half-even")), "38");
  assert.equal(decText(decPercent(d("-1"), d("8"), 0, "half-even")), "-12");
  assert.equal(decText(decPercent(d("-1"), d("8"), 0, "half-up")), "-13");
  assert.equal(decText(decPercent(d("1"), d("-8"), 1, "half-even")), "-12.5");
  assert.equal(decText(decPercent(d("5167522"), d("30038000"), 2)), "17.20");
  assert.equal(decText(decPercent(d("0.5"), d("4"), 3)), "12.500");
  assert.throws(() => decPercent(d("1"), d("0"), 2), RangeError);
});

test("no binary float enters a sum", () => {
  assert.equal(decText([d("0.1"), d("0.2")].reduce(decAdd)), "0.3");
});

test("round, floor-divide, normalize, group", () => {
  assert.equal(decText(decRound(d("2.675"), 2)), "2.68");
  assert.equal(decText(decRound(d("2.665"), 2)), "2.66");
  assert.equal(decText(decRound(d("2.665"), 2, "half-up")), "2.67");
  assert.equal(decText(decRound(d("2"), 3)), "2.000");
  assert.equal(decText(decFloorDivide(d("7"), d("2"))), "3");
  assert.equal(decText(decFloorDivide(d("-7"), d("2"))), "-4");
  assert.equal(decText(decFloorDivide(d("7"), d("-2"))), "-4");
  assert.equal(decText(decFloorDivide(d("1.5"), d("0.25"))), "6");
  assert.equal(decText(decNormalize(d("15.9560"))), "15.956");
  assert.equal(decText(decNormalize(d("10.0000"))), "10");
  assert.equal(groupThousands("1234567.891"), "1,234,567.891");
  assert.equal(groupThousands("-999"), "-999");
  assert.equal(groupThousands("1000"), "1,000");
});

test("exact JSON parsing keeps big integers and trailing zeros; plain output keeps decimals as strings", () => {
  const value = parseExactJson('{"a":9007199254740993,"b":17.20,"c":[1,2.50],"d":"x"}');
  assert.equal(decText(value.a), "9007199254740993");
  assert.equal(decText(value.b), "17.20");
  assert.deepEqual(toPlain(value), { a: "9007199254740993", b: "17.20", c: [1, "2.50"], d: "x" });
  assert.equal(canonicalText(value.c), '[1,"2.50"]');
  assert.ok(valuesEqual(d("2.0"), d("2")));
  assert.ok(!valuesEqual({ a: d("1") }, { a: d("1"), b: d("1") }));
});
