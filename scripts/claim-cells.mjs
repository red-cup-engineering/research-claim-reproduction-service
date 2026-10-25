// Each reproduced claim, also as a SignCell cell (@red-cup-engineering/signcell/cell).
//
//   subject    the ni: name of the claim-spec file the claim is stated in
//   predicate  the claim's IRI: `urn:claim:` + the claim id, percent-encoded
//   object     the derived value, as plain JSON (integers as numbers, decimals as their digit strings)
//   for        the ni: names of the source records the value was derived from (the evidence told for it)
//   against    when the paper states a different value, one witness { kind: "claim-disagreement",
//              stated, derived }; nothing when stated and derived agree
//
// The cell's value is its presence, so an agreeing claim reads "told true" (held), and a disagreeing
// claim, told for by its records and against by the paper's own statement, reads contested.
// A cell's address is its triple alone: the evidence moving does not move the claim's identity.
import canonicalJson from "@red-cup-engineering/json-services-section/canonical-json";
import { cell, cellSet } from "@red-cup-engineering/signcell/cell";
import { toPlain } from "./exact.mjs";

export const CLAIM_IRI_BASE = "urn:claim:";
export const claimIri = (id, base = CLAIM_IRI_BASE) => `${base}${encodeURIComponent(id)}`;

/**
 * @param {{ specNi: string, recordNis: Record<string, string>, results: object[], claimIriBase?: string }} input
 *   `results` are evaluateClaims results (values of the model); `recordNis` maps record name to the record's ni: name.
 * @returns the cell set, in address order
 */
export function claimCells({ specNi, recordNis, results, claimIriBase = CLAIM_IRI_BASE }) {
  const witnesses = Object.values(recordNis);
  return cellSet(results.map((result) => {
    const derived = toPlain(result.derived);
    const against = result.agrees ? [] : [{ kind: "claim-disagreement", stated: toPlain(result.stated), derived }];
    return cell(specNi, claimIri(result.id, claimIriBase), derived, { for: witnesses, against });
  }));
}

/** The cell set as deterministic text: RFC 8785 canonical JSON of the plain cell objects and a final newline. */
export const cellsText = (cells) => `${canonicalJson(JSON.parse(JSON.stringify(cells)))}\n`;
