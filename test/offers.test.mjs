// Held x402 offers: schema-valid, bound to real exports whose output matches the declared output schema,
// agreeing with package.json#x-market, and (when X402_AUTOSELL_MODULE points at the x402 package's
// src/package-offers.mjs) derivable from the package alone by autosell.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateJsonSchema } from "@red-cup-engineering/json-schema-services-section/validation";
import { fixture, json, root } from "./helpers.mjs";

const offerSchema = JSON.parse(fixture("offer.schema.json"));
const marketSchema = JSON.parse(fixture("package-market.schema.json"));
const pkg = json("package.json");
const files = readdirSync(join(root, "data/records/offers")).filter((name) => name.endsWith(".json")).sort();
const OPERATIONS = ["project-derived-tables", "reproduce-stated-claims"];
const PACKAGE = "@red-cup-engineering/research-claim-reproduction-service";

test("one offer per sold operation, priced $0.01 per call", () => {
  assert.deepEqual(files.map((name) => name.replace(/\.json$/u, "")), OPERATIONS);
  for (const file of files) assert.equal(json(`data/records/offers/${file}`).price, "$0.01");
});

test("package.json#x-market satisfies the autosell package-market schema and names the same operations", () => {
  assert.deepEqual(validateJsonSchema(pkg["x-market"], marketSchema).issues, []);
  assert.deepEqual(pkg["x-market"].offers.map((entry) => entry.operation).sort(), OPERATIONS);
  assert.equal(pkg.private, false);
  assert.equal(pkg.license, "MIT");
});

for (const file of files) {
  const operation = file.replace(/\.json$/u, "");
  const offer = json(`data/records/offers/${file}`);
  const entry = pkg["x-market"].offers.find((candidate) => candidate.operation === operation);

  test(`${operation}: offer is schema-valid, held, and sold by the engineering enterprise`, () => {
    assert.deepEqual(validateJsonSchema(offer, offerSchema).issues, []);
    assert.equal(offer.operation, operation);
    assert.equal(offer.saleStatus, "held");
    assert.deepEqual(offer.markets, ["x402-bazaar", "402index", "house-capability-market", "house-seller-catalog"]);
    assert.equal(offer.seller.enterprise, "engineering");
    assert.equal(offer.seller.record.sha256, "6af4ed9d1e4612b0383267e7ffe0ad028c52164ee3c5136110d434384a29c39f");
    assert.equal(offer.gatewayPackageName, PACKAGE);
    assert.equal(offer.ledgerAccount, "Income:Sales:X402:Research-claim-reproduction");
    assert.equal(offer.route, `/v1/${operation}`);
  });

  test(`${operation}: offer and x-market declare the same commercial terms`, () => {
    for (const key of ["route", "method", "ledgerAccount", "markets", "saleStatus", "framings", "runtime", "category"]) assert.deepEqual(offer[key], entry[key], key);
    assert.equal(offer.price, entry.price.amount);
    assert.equal(offer.compute.subpath, entry.subpath);
    assert.equal(offer.compute.export, entry.export);
    assert.deepEqual(offer.bodyExample, entry.examples.input);
    assert.deepEqual(offer.output.example, entry.examples.output);
  });

  test(`${operation}: compute binding resolves to an export whose output satisfies the offer's output schema and example`, async () => {
    const module = await import(`${PACKAGE}${offer.compute.subpath.slice(1)}`);
    assert.equal(typeof module[offer.compute.export], "function");
    assert.deepEqual(validateJsonSchema(offer.bodyExample, module.operation.inputSchema).issues, []);
    const output = module[offer.compute.export](offer.bodyExample);
    assert.deepEqual(validateJsonSchema(output, offer.output.schema).issues, []);
    assert.deepEqual(JSON.parse(JSON.stringify(output)), offer.output.example);
  });
}

test("autosell derives both offers from the package alone", { skip: process.env.X402_AUTOSELL_MODULE && process.env.HOUSE_LIB_ROOT ? false : "set X402_AUTOSELL_MODULE (src/package-offers.mjs) and HOUSE_LIB_ROOT (the lib/phezi-ochage directory)" }, async () => {
  const { deriveOffersFromPackage, loadAgency } = await import(pathToFileURL(process.env.X402_AUTOSELL_MODULE).href);
  const agency = await loadAgency({
    logicalRoot: "lib/emsenn",
    physicalRoot: process.env.HOUSE_LIB_ROOT,
    enterprises: { engineering: "services/561-group/services/engineering-services-section/lib/agency/enterprises/engineering.json" },
  });
  const derived = await deriveOffersFromPackage({ packageRoot: root, agency });
  assert.deepEqual(derived.refusals, []);
  assert.equal(derived.ok, true);
  assert.deepEqual(derived.declarations.map((declaration) => declaration.operation).sort(), OPERATIONS);
  for (const declaration of derived.declarations) {
    const held = json(`data/records/offers/${declaration.operation}.json`);
    for (const key of ["gateway", "gatewayPackageName", "operation", "route", "method", "price", "ledgerAccount", "markets", "saleStatus", "seller", "compute", "bodyExample", "output"]) {
      assert.deepEqual(declaration[key], held[key], `${declaration.operation} ${key}`);
    }
  }
});
