// The command face shared by every operation script; loaded only when a script runs as a command.
export async function runCommand(operationDefinition, operation) {
  const { runJavascriptNodeOperation } = await import("@red-cup-engineering/javascript-node-services-section/operation");
  process.exitCode = (await runJavascriptNodeOperation(
    { ...operationDefinition, operation },
    { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout },
  )).exitCode;
}

export const requestProperties = {
  records: { type: "object", description: "Record name (as named in spec.records) to the record's parsed JSON value. Numbers arrive as doubles, so integers beyond 2^53 and decimals with more than 17 significant digits are not exact; use recordTexts for those." },
  recordTexts: { type: "object", additionalProperties: { type: "string" }, description: "Record name to the record's JSON text; every number literal is read exactly. A record is given in records or in recordTexts, not both." },
  spec: { type: "object", description: "The claim-spec: records, bindings, claims and (for projection) tables and documents. See schemas/claim-spec.schema.json." },
};

export const claimResultSchema = {
  type: "object",
  required: ["id", "manuscript", "stated", "derived", "agrees", "basis"],
  properties: {
    id: { type: "string" },
    manuscript: { type: "string" },
    stated: {},
    derived: {},
    agrees: { type: "boolean" },
    basis: { type: "string" },
  },
};

export const claimSummarySchema = {
  type: "object",
  required: ["total", "agreed", "disagreed", "ok"],
  properties: {
    total: { type: "integer", minimum: 0 },
    agreed: { type: "integer", minimum: 0 },
    disagreed: { type: "array", items: { type: "string" } },
    ok: { type: "boolean" },
  },
};
