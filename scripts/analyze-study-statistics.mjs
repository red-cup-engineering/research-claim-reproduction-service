/**
 * Source-qualified study statistics over original data and Metrologic arithmetic.
 * All sample selection, rights, and scientific acceptance remain external.
 */
import {
  finiteSampleMoments, weightedSampleMean, stratifiedSrsworMean, cohenKappa,
} from "@red-cup-engineering/metrologic/statistics/finite-sample";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";

const FIELDS = Object.freeze({
  descriptive: ["id", "value"],
  "weighted-descriptive": ["id", "value", "weight"],
  "stratified-srswor": ["id", "value", "stratum"],
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
export function analyzeStudyStatistics({ study, records }) {
  const metadata = object(study, "study");
  fields(metadata, ["id","researchQuestion","population","unitOfAnalysis",
    "analysisMethod","variable","provenance","access","strata",
    "samplingFrame","missingPolicy"], "study");
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
  const missing = method !== "coder-agreement" ? rows.filter(row => row.value === null).length : 0;
  if (missing && (method === "stratified-srswor" || policy !== "complete-case-descriptive"))
    throw new TypeError("missingness cannot silently become a population inference");
  if (method === "stratified-srswor" && policy === "complete-case-descriptive")
    throw new TypeError("complete-case dropping cannot certify a probability sample");
  const observed = missing ? rows.filter(row => row.value !== null) : rows;
  if (!observed.length) throw new RangeError("no observed values remain");
  const computedRecordsAddress = semanticId(records);
  if (provenance.expectedRecordsAddress !== undefined &&
      provenance.expectedRecordsAddress !== computedRecordsAddress)
    throw new TypeError("records differ from the claimed source content address");
  let result, inferentialStatus = "descriptive-supplied-records-only";
  if (method === "descriptive") {
    result = finiteSampleMoments(observed.map(row => row.value));
  } else if (method === "weighted-descriptive") {
    result = weightedSampleMean(observed.map(row => row.value),
      observed.map(row => row.weight));
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
        values: observed.filter(row => row.stratum === groupId).map(row => row.value) };
    });
    if (observed.some(row => !names.has(row.stratum)))
      throw new TypeError("case refers to an unknown sampling stratum");
    result = stratifiedSrsworMean(strata);
    inferentialStatus = "conditional-on-unverified-SRSWOR-selection-and-complete-response";
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
    analysisMethod: method, recordCount: rows.length,
    analyzedCount: observed.length, missingCount: missing, missingPolicy: policy,
    result, inferentialStatus,
    provenance: Object.freeze({ datasetId, claimedRevision, codebookRef,
      computedRecordsAddress, sourceAuthenticity: "not-independently-verified" }),
    scientificReceiving: "not-independently-received",
    publicationAuthorized: false,
    disclosure: "aggregates-only-no-microdata",
  });
}
