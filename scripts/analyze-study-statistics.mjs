#!/usr/bin/env node
import { runCommand } from "./claim-face.mjs";
import studyAnalysisSchema from "../schemas/study-analysis.schema.json" with { type: "json" };
/**
 * Source-qualified study statistics over original data and Metrologic arithmetic.
 * All sample selection, rights, and scientific acceptance remain external.
 */
import {
  finiteSampleMoments, weightedSampleMean, stratifiedSrsworMean, cohenKappa,
  completeRandomizationTest, simpleLinearRegression,
} from "@red-cup-engineering/metrologic/statistics/finite-sample";
import { ratFromInt } from "@red-cup-engineering/metrologic/number/exact-number";
import { rationalOfDecimal } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import {
  hostRatioOfRational, rationalOfHostRatio,
} from "@red-cup-engineering/exact-number-data-service/wire-ratio";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address-system";

const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

function readMeasurement(value) {
  if (Number.isSafeInteger(value)) return ratFromInt(value);
  if (typeof value === "string") {
    if (value.length > 128 || !DECIMAL.test(value))
      throw new TypeError("measurement must be a bounded canonical decimal string");
    if ((value.split(".")[1]?.length ?? 0) > 36)
      throw new RangeError("measurement has more than 36 decimal places");
    return rationalOfDecimal(value);
  }
  if (value && typeof value === "object") {
    if (typeof value.numerator !== "string" || typeof value.denominator !== "string" ||
        value.numerator.length > 128 || value.denominator.length > 128)
      throw new TypeError("measurement ratio exceeds bounded canonical integer fields");
    return rationalOfHostRatio(value);
  }
  throw new TypeError("measurement must be an exact decimal string, safe integer or canonical ratio");
}

function writeAnalysis(value) {
  if (value?.kind === "exactNumber.rational") return hostRatioOfRational(value);
  if (Array.isArray(value)) return Object.freeze(value.map(writeAnalysis));
  if (value && typeof value === "object")
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, writeAnalysis(item)]),
    ));
  return value;
}

/**
 * Read only own data properties from plain JSON carriers, exactly once.
 * The resulting deep-frozen copy is used for both source addressing and
 * arithmetic so an accessor cannot change a measured value across the two.
 * This is source consistency, NOT provenance authentication or consent.
 */
function snapshotStudyInput(input) {
  const active = new WeakSet();
  let nodes = 0;
  const snapshot = (value, depth = 0) => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object" || depth > 32)
      throw new TypeError("study input requires bounded plain JSON data");
    if (++nodes > 150000)
      throw new RangeError("study input exceeds safe snapshot size");
    if (active.has(value))
      throw new TypeError("study input cannot contain cyclic data");
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype :
        prototype !== Object.prototype && prototype !== null)
      throw new TypeError("study input requires plain JSON records");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const output = array ? [] : {};
    active.add(value);
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length > 100000 ||
          keys.length !== length + 1)
        throw new TypeError("study input requires dense finite arrays");
      for (let index = 0; index < length; index++) {
        const property = descriptors[String(index)];
        if (!property || !Object.hasOwn(property, "value") || !property.enumerable)
          throw new TypeError("study input requires owned array elements");
        output.push(snapshot(property.value, depth + 1));
      }
    } else {
      for (const key of keys) {
        const property = descriptors[key];
        if (typeof key !== "string" || !property.enumerable ||
            !Object.hasOwn(property, "value"))
          throw new TypeError("study input requires own data properties (no accessors)");
        Object.defineProperty(output, key, {
          value: snapshot(property.value, depth + 1),
          enumerable: true, writable: false, configurable: false,
        });
      }
    }
    active.delete(value);
    return Object.freeze(output);
  };
  return snapshot(input);
}

const FIELDS = Object.freeze({
  descriptive: ["id", "value"],
  "weighted-descriptive": ["id", "value", "weight"],
  "stratified-srswor": ["id", "value", "stratum"],
  "complete-randomization-test": ["id", "value", "treated"],
  "simple-linear-regression": ["id", "predictor", "value"],
  "coder-agreement": ["id", "coderA", "coderB"],
});
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(label + " must be an object");
  return value;
}
function string(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 512)
    throw new TypeError(label + " must be bounded nonempty text");
  return value;
}
function fields(value, allowed, label) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new TypeError(label + " has unexpected field " + key);
}

/** The result contains no raw cases, publication grant or statistical significance.
 * Its dataset identity is computed from original records with the existing
 * content-address provider, not invented by a model. */
export function analyzeStudyStatistics(request) {
  const input = object(snapshotStudyInput(request), "study request");
  fields(input, ["study", "records"], "study request");
  const { study, records } = input;
  const metadata = object(study, "study");
  fields(metadata, ["id","researchQuestion","population","unitOfAnalysis",
    "analysisMethod","variable","provenance","access","strata",
    "samplingFrame","missingPolicy","randomizationProtocol","randomizationStatus","predictor"], "study");
  const id = string(metadata.id, "study id");
  const researchQuestion = string(metadata.researchQuestion, "research question");
  const population = string(metadata.population, "target population");
  const unitOfAnalysis = string(metadata.unitOfAnalysis, "unit of analysis");
  const method = metadata.analysisMethod;
  if (!Object.hasOwn(FIELDS, method)) throw new TypeError("unknown statistical method");
  const variable = object(metadata.variable, "measurement");
  fields(variable, ["name","measurementLevel","unit","categories"], "measurement");
  const variableName = string(variable.name, "variable");
  const measurementLevel = variable.measurementLevel;
  if (method === "coder-agreement") {
    if (measurementLevel !== "nominal" || !Array.isArray(variable.categories) ||
        variable.categories.length < 2 || variable.categories.length > 128)
      throw new TypeError("coding needs a nominal variable with 2..128 declared categories");
    for (const category of variable.categories) string(category, "codebook category");
    if (new Set(variable.categories).size !== variable.categories.length)
      throw new TypeError("duplicate codebook category");
  } else if (!["interval","ratio"].includes(measurementLevel))
    throw new TypeError("numeric statistics require interval or ratio measurements");
  const provenance = object(metadata.provenance, "source provenance");
  fields(provenance, ["datasetId","claimedRevision","codebookRef","expectedRecordsAddress"], "source provenance");
  const datasetId = string(provenance.datasetId, "dataset id");
  const claimedRevision = string(provenance.claimedRevision, "claimed revision");
  const codebookRef = string(provenance.codebookRef, "codebook reference");
  const access = object(metadata.access, "data access");
  fields(access, ["analysisPermission","privacyPolicy"], "data access");
  if (access.analysisPermission !== "caller-declares-authorized" ||
      access.privacyPolicy !== "aggregates-only")
    throw new TypeError("aggregate analysis requires explicit caller-declared permission; independent rights review remains required");
  if (!Array.isArray(records) || records.length < 1 || records.length > 10000)
    throw new RangeError("records must contain 1..10000 cases");
  const seen = new Set(), accepted = FIELDS[method];
  const rows = records.map(input => {
    const row = object(input, "case");
    fields(row, accepted, "case");
    const caseId = string(row.id, "case id");
    if (seen.has(caseId)) throw new TypeError("duplicate case identifier");
    seen.add(caseId);
    for (const field of accepted)
      if (!Object.hasOwn(row, field)) throw new TypeError("case missing " + field);
    return row;
  });
  const policy = metadata.missingPolicy ?? "refuse";
  if (!["refuse","complete-case-descriptive"].includes(policy))
    throw new TypeError("unknown missing data policy");
  const missing = method !== "coder-agreement"
    ? rows.filter(row => row.value === null ||
        (method === "simple-linear-regression" && row.predictor === null)).length : 0;
  if (missing && (["stratified-srswor","complete-randomization-test"].includes(method) || policy !== "complete-case-descriptive"))
    throw new TypeError("missingness cannot silently become a population inference");
  if (["stratified-srswor","complete-randomization-test"].includes(method) && policy === "complete-case-descriptive")
    throw new TypeError("complete-case dropping cannot certify a probability sample");
  const observed = missing ? rows.filter(row => row.value !== null &&
    (method !== "simple-linear-regression" || row.predictor !== null)) : rows;
  if (!observed.length) throw new RangeError("no observed values remain");
  const computedRecordsAddress = semanticId(records);
  if (provenance.expectedRecordsAddress !== undefined &&
      provenance.expectedRecordsAddress !== computedRecordsAddress)
    throw new TypeError("records differ from the claimed source content address");
  let result, inferentialStatus = "descriptive-supplied-records-only";
  if (method === "descriptive") {
    result = finiteSampleMoments(observed.map(row => readMeasurement(row.value)));
  } else if (method === "weighted-descriptive") {
    result = weightedSampleMean(observed.map(row => readMeasurement(row.value)),
      observed.map(row => readMeasurement(row.weight)));
  } else if (method === "stratified-srswor") {
    string(metadata.samplingFrame, "sampling frame");
    if (!Array.isArray(metadata.strata) || metadata.strata.length < 1 || metadata.strata.length > 128)
      throw new TypeError("known population strata required");
    const names = new Set();
    const strata = metadata.strata.map(group => {
      const s = object(group, "stratum");
      fields(s, ["id","populationSize"], "stratum");
      const groupId = string(s.id, "stratum id");
      if (names.has(groupId)) throw new TypeError("duplicate sampling stratum");
      names.add(groupId);
      return { id: groupId, populationSize: s.populationSize,
        values: observed.filter(row => row.stratum === groupId).map(row => readMeasurement(row.value)) };
    });
    if (observed.some(row => !names.has(row.stratum)))
      throw new TypeError("case refers to an unknown sampling stratum");
    result = stratifiedSrsworMean(strata);
    inferentialStatus = "conditional-on-unverified-SRSWOR-selection-and-complete-response";
  } else if (method === "simple-linear-regression") {
    const predictor = object(metadata.predictor, "regression predictor");
    fields(predictor, ["name","measurementLevel","unit"], "regression predictor");
    string(predictor.name, "predictor name");
    if (!["ratio","interval"].includes(predictor.measurementLevel))
      throw new TypeError("regression predictor requires interval or ratio measurements");
    result = simpleLinearRegression(observed.map(row => readMeasurement(row.predictor)),
      observed.map(row => readMeasurement(row.value)));
    inferentialStatus = "descriptive-association-not-causal-identification";
  } else if (method === "complete-randomization-test") {
    string(metadata.randomizationProtocol, "randomization protocol");
    if (metadata.randomizationStatus !== "caller-declares-randomized")
      throw new TypeError("a declared randomized allocation protocol is required");
    result = completeRandomizationTest(
      observed.map(row => readMeasurement(row.value)), observed.map(row => row.treated));
    inferentialStatus = "conditional-on-unverified-complete-randomization-and-sharp-null";
  } else {
    const categories = variable.categories;
    for (const row of rows)
      if (!categories.includes(row.coderA) || !categories.includes(row.coderB))
        throw new TypeError("coder classification not in declared codebook categories");
    result = cohenKappa(rows.map(row => row.coderA), rows.map(row => row.coderB));
    inferentialStatus = "intercoder-agreement-not-construct-validation";
  }
  return Object.freeze({
    kind: "research.statistics.study-analysis",
    studyId: id, researchQuestion, population, unitOfAnalysis,
    variable: Object.freeze({ name: variableName, measurementLevel,
      ...(variable.unit === undefined ? {} : { unit: string(variable.unit,"unit") }) }),
    analysisMethod: method,
    ...(method === "simple-linear-regression" ? {
      predictor: Object.freeze({
        name: metadata.predictor.name, measurementLevel: metadata.predictor.measurementLevel,
        ...(metadata.predictor.unit === undefined ? {} : {
          unit: string(metadata.predictor.unit,"predictor unit"),
        }),
      }),
    } : {}),
    recordCount: rows.length,
    analyzedCount: observed.length, missingCount: missing, missingPolicy: policy,
    result: writeAnalysis(result), inferentialStatus,
    provenance: Object.freeze({ datasetId, claimedRevision, codebookRef,
      computedRecordsAddress, sourceAuthenticity: "not-independently-verified" }),
    scientificReceiving: "not-independently-received",
    publicationAuthorized: false,
    disclosure: "aggregates-only-no-microdata",
  });
}

export const operationDefinition = Object.freeze({
  name: "analyzeStudyStatistics",
  description: "Source-qualified descriptive, survey, coding, experiment and regression statistics; no independent scientific or publication authority.",
  inputSchema: studyAnalysisSchema,
  outputSchema: {
    type: "object",
    required: ["kind","studyId","result","provenance","inferentialStatus",
      "scientificReceiving","publicationAuthorized"],
    properties: {
      kind: { const: "research.statistics.study-analysis" },
      studyId: { type: "string" },
      result: { type: "object" },
      provenance: { type: "object" },
      inferentialStatus: { type: "string" },
      scientificReceiving: { const: "not-independently-received" },
      publicationAuthorized: { const: false },
    },
    additionalProperties: true,
  },
});
export const operation = operationDefinition;
if (import.meta.main) await runCommand(operationDefinition, analyzeStudyStatistics);
