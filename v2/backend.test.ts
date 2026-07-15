// Pins the pure LLM-output parsers and the shell escaper in v2/backend.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { __test } from "./backend.ts";

const { modelJsonArray, modelJsonObject, shq } = __test;

test("modelJsonArray parses fenced json", () => {
  assert.deepEqual(modelJsonArray('```json\n[1,2]\n```'), [1, 2]);
});

test("modelJsonArray extracts array from surrounding prose", () => {
  assert.deepEqual(modelJsonArray('prose then [{"a":1}] trailing'), [{ a: 1 }]);
});

test("modelJsonArray returns null on garbage", () => {
  assert.equal(modelJsonArray("not json at all"), null);
});

test("modelJsonArray rejects a bare object", () => {
  assert.equal(modelJsonArray('{"a":1}'), null);
});

test("modelJsonObject parses fenced object", () => {
  assert.deepEqual(modelJsonObject('```\n{"x":1}\n```'), { x: 1 });
});

test("modelJsonObject rejects an array", () => {
  assert.equal(modelJsonObject("[1,2]"), null);
});

test("modelJsonObject returns null on garbage", () => {
  assert.equal(modelJsonObject("garbage"), null);
});

test("shq single-quote escapes for shell argv", () => {
  assert.equal(shq("it's"), "'it'\\''s'");
});
