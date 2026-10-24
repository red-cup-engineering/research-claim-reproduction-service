#!/usr/bin/env node
import { createHash } from "node:crypto";
import { admitRequest, projectAll, summarizeClaims } from "./engine.mjs";
import { claimSummarySchema, requestProperties, runCommand } from "./claim-face.mjs";

export const operationDefinition = {
  name: "projectDerivedTables",
  description: "Projects the derived tables a claim-spec declares from a paper's source records: deterministic CSV (RFC 4180, LF), Pandoc pipe-table Markdown documents and the claim-results JSON, each with its SHA-256 and byte length.",
  inputSchema: {
    type: "object",
    required: ["spec"],
    additionalProperties: false,
    properties: requestProperties,
  },
  outputSchema: {
    type: "object",
    required: ["files", "claims"],
    additionalProperties: false,
    properties: {
      files: {
        type: "array",
        items: {
          type: "object",
          required: ["path", "text", "sha256", "bytes"],
          additionalProperties: false,
          properties: {
            path: { type: "string" },
            text: { type: "string" },
            sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
            bytes: { type: "integer", minimum: 0 },
            variants: { type: "object", description: "Legacy renderings of the same file: crlf holds the digest of the text with every LF replaced by CRLF." },
          },
        },
      },
      claims: claimSummarySchema,
    },
  },
};
export const operation = operationDefinition;

const digest = (text) => {
  const bytes = new TextEncoder().encode(text);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
};

/**
 * Projects every output file of a claim-spec: tables as CSV, documents as Pandoc Markdown, and the claim results.
 * @param {{records?: object, recordTexts?: object, spec: object}} request
 * @returns {{files: {path: string, text: string, sha256: string, bytes: number, variants?: object}[], claims: object}}
 * @throws {TypeError} When the request or spec is malformed, or a record is not valid JSON or not supplied.
 * @throws {RangeError} When a column, caption or block cannot be evaluated (missing pointer, non-scalar cell, division by zero, step budget).
 */
export function projectDerivedTables(request) {
  const { spec, records } = admitRequest(request, "projectDerivedTables");
  const { files, results } = projectAll(spec, records);
  return {
    files: files.map(({ path, text, crlfDigest }) => ({
      path,
      text,
      ...digest(text),
      ...(crlfDigest ? { variants: { crlf: digest(text.replaceAll("\n", "\r\n")) } } : {}),
    })),
    claims: summarizeClaims(results),
  };
}

if (import.meta.main) await runCommand(operationDefinition, projectDerivedTables);
