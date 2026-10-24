import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, "..");
export const fixture = (name) => readFileSync(join(here, "fixtures", name), "utf8");
export const json = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
export const paperFixture = join(here, "fixtures", "white-repopulation");

/** A fresh copy of the white-repopulation snapshot, without its derived outputs. */
export function paperCopy() {
  const directory = mkdtempSync(join(tmpdir(), "claim-repro-"));
  for (const part of ["claims", "data/records"]) cpSync(join(paperFixture, part), join(directory, part), { recursive: true });
  return directory;
}

/** A spec with the given bindings and claims over the given record names. */
export const specOf = (claims, extra = {}) => ({ specVersion: "1", records: {}, claims, ...extra });
export const claimOf = (expression, stated, id = "c") => ({ id, manuscript: "m", stated, expression, basis: "b" });
