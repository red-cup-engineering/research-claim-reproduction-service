#!/usr/bin/env node
import { admitRequest, evaluateClaims, summarizeClaims } from "./engine.mjs";
import { toPlain } from "./exact.mjs";
import { claimResultSchema, claimSummarySchema, requestProperties, runCommand } from "./claim-face.mjs";

export const operationDefinition = {
  name: "reproduceStatedClaims",
  description: "Recomputes every quantitative claim a research paper states from its source records, in exact decimal arithmetic, and reports for each claim the stated value, the derived value and whether they agree.",
  inputSchema: {
    type: "object",
    required: ["spec"],
    additionalProperties: false,
    properties: requestProperties,
  },
  outputSchema: {
    type: "object",
    required: ["results", "total", "agreed", "disagreed", "ok"],
    additionalProperties: false,
    properties: {
      results: { type: "array", items: claimResultSchema },
      ...claimSummarySchema.properties,
    },
  },
};
export const operation = operationDefinition;

/**
 * Derives every claim of a claim-spec from its records and compares it with the stated value.
 * A disagreement is a result (`agrees: false`, `ok: false`), not a refusal.
 * @param {{records?: object, recordTexts?: object, spec: object}} request
 * @returns {{results: object[], total: number, agreed: number, disagreed: string[], ok: boolean}}
 * @throws {TypeError} When the request or spec is malformed (every problem is listed), or a record is not valid JSON or not supplied.
 * @throws {RangeError} When a claim cannot be evaluated: a missing pointer, an index out of range, division by zero, a duplicate claim id, or the step budget exceeded.
 */
export function reproduceStatedClaims(request) {
  const { spec, records } = admitRequest(request, "reproduceStatedClaims");
  const results = evaluateClaims(spec, records);
  return { results: toPlain(results), ...summarizeClaims(results) };
}

if (import.meta.main) await runCommand(operationDefinition, reproduceStatedClaims);
