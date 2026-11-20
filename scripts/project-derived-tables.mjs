#!/usr/bin/env node
import { addressContent } from "@red-cup-engineering/computer-content-address-engineering-services-section/content-address";
import { admitRequest, projectAll, summarizeClaims } from "./engine.mjs";
import { claimSummarySchema, requestProperties, runCommand } from "./claim-face.mjs";

export const operationDefinition = {
  name: "projectDerivedTables",
  description: "Projects the derived tables a claim-spec declares from a paper's source records: deterministic CSV (RFC 4180, LF), Pandoc pipe-table Markdown documents and the claim-results JSON, each with its RFC 6920 ni: content address, byte size and media type.",
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
          required: ["path", "text", "ni", "size", "mediaType"],
          additionalProperties: false,
          properties: {
            path: { type: "string" },
            text: { type: "string" },
            ni: { type: "string", pattern: "^ni:///sha-256;[A-Za-z0-9_-]{43}$", description: "The RFC 6920 name of the file's UTF-8 bytes." },
            size: { type: "integer", minimum: 0, description: "The file's UTF-8 byte length." },
            mediaType: { type: "string", description: "The media type the bytes are named as, from the file's extension." },
            variants: { type: "object", description: "Legacy renderings of the same file: crlf holds the address (ni, size, mediaType) of the text with every LF replaced by CRLF." },
          },
        },
      },
      claims: claimSummarySchema,
    },
  },
};
export const operation = operationDefinition;

const MEDIA_TYPES = Object.freeze({ csv: "text/csv", md: "text/markdown", json: "application/json" });
const mediaTypeOf = (path) => MEDIA_TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";

/** The house content address of a file's UTF-8 bytes: { ni, size, mediaType }. */
export function addressText(text, path) {
  const { ni, size, mediaType } = addressContent(new TextEncoder().encode(text), { mediaType: mediaTypeOf(path) });
  return { ni, size, mediaType };
}

/**
 * Projects every output file of a claim-spec: tables as CSV, documents as Pandoc Markdown, and the claim results.
 * @param {{records?: object, recordTexts?: object, spec: object}} request
 * @returns {{files: {path: string, text: string, ni: string, size: number, mediaType: string, variants?: object}[], claims: object}}
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
      ...addressText(text, path),
      ...(crlfDigest ? { variants: { crlf: addressText(text.replaceAll("\n", "\r\n"), path) } } : {}),
    })),
    claims: summarizeClaims(results),
  };
}

if (import.meta.main) await runCommand(operationDefinition, projectDerivedTables);
