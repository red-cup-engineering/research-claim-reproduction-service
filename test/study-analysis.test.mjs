import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { semanticBytes } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { analyzeStudyStatistics, operationDefinition } from "../scripts/analyze-study-statistics.mjs";

const study = (analysisMethod = "descriptive") => ({
  id: "urn:study:synthetic",
  researchQuestion: "What can be calculated from these cases?",
  population: "Defined synthetic finite population",
  unitOfAnalysis: "synthetic-case",
  analysisMethod,
  variable: analysisMethod === "coder-agreement"
    ? { name: "code", measurementLevel: "nominal", categories: ["yes","no"] }
    : { name: "outcome", measurementLevel: "ratio", unit: "points" },
  provenance: { datasetId: "urn:dataset:synthetic", claimedRevision: "source-v1",
    codebookRef: "urn:codebook:synthetic" },
  access: { analysisPermission: "caller-declares-authorized",
    privacyPolicy: "aggregates-only" },
});
const rows = values => values.map((value, index) => ({id: "case-"+index, value}));

test("direct operation and declared schema both reject unknown request fields", () => {
  assert.equal(operationDefinition.inputSchema.additionalProperties,false);
  assert.throws(()=>analyzeStudyStatistics({study:study(),records:rows([1,2]),unexpected:true}),/unexpected field/);
});

test("real canonical source bytes independently reproduce the reported SHA-256 NI", () => {
  const records=rows(["0.1","0.2","0.3"]);
  const expected="ni:///sha-256;"+createHash("sha256").update(semanticBytes(records)).digest("base64url");
  const answer=analyzeStudyStatistics({study:{...study(),provenance:{...study().provenance,expectedRecordsAddress:expected}},records});
  assert.equal(answer.provenance.computedRecordsAddress,expected);
  records[0].value="900";
  assert.equal(answer.provenance.computedRecordsAddress,expected);
  assert.notEqual(analyzeStudyStatistics({study:study(),records}).provenance.computedRecordsAddress,expected);
  assert.throws(()=>analyzeStudyStatistics({study:{...study(),provenance:{...study().provenance,expectedRecordsAddress:expected}},records}),/differ/);
});

test("native statistics command uses real schema, math and source identity without stubs", () => {
  const script=fileURLToPath(new URL("../scripts/analyze-study-statistics.mjs",import.meta.url));
  const valid={study:study(),records:rows(["2","4","6"])};
  const run=spawnSync(process.execPath,[script],{input:JSON.stringify(valid)+"\n"+JSON.stringify({...valid,unexpected:true})+"\n",encoding:"utf8"});
  assert.equal(run.status,2,run.stderr);
  const outputs=run.stdout.trim().split("\n").map(line=>JSON.parse(line));
  assert.deepEqual(outputs[0],JSON.parse(JSON.stringify(analyzeStudyStatistics(valid))));
  assert.equal(outputs[1].ok,false);assert.equal(outputs[1].refusal.reason,"InvalidInput");
  assert.equal(outputs[0].publicationAuthorized,false);
  const help=spawnSync(process.execPath,[script,"--help"],{encoding:"utf8"});
  assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/analyzeStudyStatistics/);
});

test("descriptive moments do not acquire inferential or publication authority", () => {
  const answer=analyzeStudyStatistics({study:study(), records:rows(["2","4","6"])});
  assert.deepEqual(answer.result.mean,{numerator:"4",denominator:"1"});
  assert.deepEqual(answer.result.sampleVariance,{numerator:"4",denominator:"1"});
  assert.equal(answer.inferentialStatus,"descriptive-supplied-records-only");
  assert.equal(answer.scientificReceiving,"not-independently-received");
  assert.equal(answer.publicationAuthorized,false);
});

test("missing cases require an explicit descriptive-only policy", () => {
  const data=rows(["1",null,"3"]);
  assert.throws(()=>analyzeStudyStatistics({study:study(),records:data}),/missingness/);
  const answer=analyzeStudyStatistics({study:{...study(),missingPolicy:"complete-case-descriptive"},records:data});
  assert.equal(answer.missingCount,1);
  assert.equal(answer.analyzedCount,2);
  assert.deepEqual(answer.result.mean,{numerator:"2",denominator:"1"});
});

test("weighted mean and Kish n are descriptive, not a survey design", () => {
  const data=[{id:"A",value:"1",weight:"1"},{id:"B",value:"3",weight:"3"}];
  const answer=analyzeStudyStatistics({study:study("weighted-descriptive"),records:data});
  assert.deepEqual(answer.result.weightedMean,{numerator:"5",denominator:"2"});
  assert.deepEqual(answer.result.kishEffectiveSampleSize,{numerator:"8",denominator:"5"});
  assert.match(answer.result.inferenceStatus,/descriptive-only/);
});

test("stratified finite population survey preserves the exact estimator and unverified design", () => {
  const experiment={...study("stratified-srswor"),samplingFrame:"urn:frame:synthetic",
    strata:[{id:"one",populationSize:10},{id:"two",populationSize:10}]};
  const data=[{id:"A",stratum:"one",value:"2"},{id:"B",stratum:"one",value:"4"},
    {id:"C",stratum:"two",value:"10"},{id:"D",stratum:"two",value:"14"}];
  const answer=analyzeStudyStatistics({study:experiment,records:data});
  assert.deepEqual(answer.result.estimate,{numerator:"15",denominator:"2"});
  assert.deepEqual(answer.result.estimatedVariance,{numerator:"1",denominator:"1"});
  assert.match(answer.inferentialStatus,/unverified-SRSWOR/);
  assert.equal("confidenceInterval" in answer.result,false);
  assert.equal(answer.publicationAuthorized,false);
});

test("nonresponse, unknown sampling frames and drop policies fail closed", () => {
  const experiment={...study("stratified-srswor"),samplingFrame:"urn:frame:synthetic",
    strata:[{id:"one",populationSize:5}]};
  assert.throws(()=>analyzeStudyStatistics({study:experiment,
    records:[{id:"A",stratum:"one",value:null}]}),/missingness/);
  assert.throws(()=>analyzeStudyStatistics({study:{...experiment,missingPolicy:"complete-case-descriptive"},
    records:[{id:"A",stratum:"one",value:2}]}),/cannot certify/);
  assert.throws(()=>analyzeStudyStatistics({study:experiment,
    records:[{id:"A",stratum:"invented",value:2}]}),/unknown sampling stratum/);
});

test("codebook-constrained categorical coding can compute agreement, not construct validity", () => {
  const data=["yes","yes","no","no"].map((coderA,index)=>({
    id:"case-"+index, coderA, coderB:["yes","no","no","no"][index],
  }));
  const answer=analyzeStudyStatistics({study:study("coder-agreement"),records:data});
  assert.deepEqual(answer.result.kappa,{numerator:"1",denominator:"2"});
  assert.equal(answer.inferentialStatus,"intercoder-agreement-not-construct-validation");
  assert.throws(()=>analyzeStudyStatistics({study:study("coder-agreement"),
    records:[{id:"A",coderA:"yes",coderB:"unlisted"},{id:"B",coderA:"no",coderB:"no"}]}),
    /codebook categories/);
});

test("duplicate cases, undeclared sensitive columns and no analysis consent are refused", () => {
  assert.throws(()=>analyzeStudyStatistics({study:study(),
    records:[{id:"A",value:2},{id:"A",value:4}]}),/duplicate case/);
  assert.throws(()=>analyzeStudyStatistics({study:study(),
    records:[{id:"A",value:2,email:"private@example.org"}]}),/unexpected field/);
  assert.throws(()=>analyzeStudyStatistics({study:{...study(),
    access:{analysisPermission:"denied",privacyPolicy:"aggregates-only"}},
    records:rows([2])}),/aggregate analysis/);
});

test("computed original content identity can be checked and microdata never appear in the output", () => {
  const data=[{id:"participant-unique",value:"8"}];
  const answer=analyzeStudyStatistics({study:study(),records:data});
  assert.equal(JSON.stringify(answer).includes("participant-unique"),false);
  assert.equal(answer.provenance.sourceAuthenticity,"not-independently-verified");
  assert.equal(typeof answer.provenance.computedRecordsAddress,"string");
  assert.throws(()=>analyzeStudyStatistics({study:{...study(),
    provenance:{...study().provenance,expectedRecordsAddress:"ni:///sha-256;wrong"}},
    records:data}),/source content address/);
});

test("invalid analysis level, unsupported method, no codebook or bad numbers fail", () => {
  assert.throws(()=>analyzeStudyStatistics({study:{...study(),
    variable:{name:"outcome",measurementLevel:"nominal"}},records:rows([1])}),
    /interval or ratio/);
  assert.throws(()=>analyzeStudyStatistics({study:{...study(),analysisMethod:"predict-causality"},
    records:rows([1])}),/unknown statistical method/);
  assert.throws(()=>analyzeStudyStatistics({study:{...study(),
    provenance:{datasetId:"urn:d",claimedRevision:"source-v1"}},records:rows([1])}),
    /codebook reference/);
  assert.throws(()=>analyzeStudyStatistics({study:study(),records:rows([NaN])}));
});

test("exact two-sided randomized experiment test never upgrades claimed allocation to causality", () => {
  const protocol={...study("complete-randomization-test"),
    randomizationProtocol:"urn:protocol:synthetic-complete-randomization",
    randomizationStatus:"caller-declares-randomized"};
  const data=[{id:"A",value:"10",treated:true},{id:"B",value:"10",treated:true},
    {id:"C",value:"0",treated:false},{id:"D",value:"0",treated:false}];
  const answer=analyzeStudyStatistics({study:protocol,records:data});
  assert.deepEqual(answer.result.pValue,{numerator:"1",denominator:"3"});
  assert.equal(answer.result.enumeratedAllocations,6);
  assert.equal(answer.inferentialStatus,
    "conditional-on-unverified-complete-randomization-and-sharp-null");
  assert.equal(answer.scientificReceiving,"not-independently-received");
  assert.equal(answer.publicationAuthorized,false);
});

test("unverified, incomplete or convenience allocations cannot silently receive a randomized p-value", () => {
  const protocol={...study("complete-randomization-test"),
    randomizationProtocol:"urn:protocol:synthetic",
    randomizationStatus:"caller-declares-randomized"};
  assert.throws(()=>analyzeStudyStatistics({study:{...protocol,randomizationStatus:"convenience-sample"},
    records:[{id:"A",value:1,treated:true},{id:"B",value:2,treated:false}]}),
    /declared randomized allocation/);
  assert.throws(()=>analyzeStudyStatistics({study:protocol,
    records:[{id:"A",value:null,treated:true},{id:"B",value:2,treated:false}]}),
    /missingness/);
  assert.throws(()=>analyzeStudyStatistics({study:protocol,
    records:[{id:"A",value:1,treated:true},{id:"B",value:2,treated:true}]}),
    /nonempty randomized arms/);
});

test("exact regression estimates observed association without causal identification", () => {
  const protocol={...study("simple-linear-regression"),
    predictor:{name:"input",measurementLevel:"interval",unit:"points"}};
  const data=[{id:"A",predictor:"1",value:"2"},
    {id:"B",predictor:"2",value:"4"},{id:"C",predictor:"3",value:"6"}];
  const result=analyzeStudyStatistics({study:protocol,records:data});
  assert.deepEqual(result.result.slope,{numerator:"2",denominator:"1"});
  assert.deepEqual(result.result.rSquared,{numerator:"1",denominator:"1"});
  assert.equal(result.inferentialStatus,"descriptive-association-not-causal-identification");
  assert.equal("pValue" in result.result,false);
});
test("paired missingness requires disclosure and invalid predictor scales fail", () => {
  const protocol={...study("simple-linear-regression"),
    predictor:{name:"input",measurementLevel:"interval"}};
  const data=[{id:"A",predictor:"1",value:"2"},
    {id:"B",predictor:null,value:"4"},{id:"C",predictor:"3",value:"6"}];
  assert.throws(()=>analyzeStudyStatistics({study:protocol,records:data}),/missingness/);
  const observed=analyzeStudyStatistics({study:{...protocol,missingPolicy:"complete-case-descriptive"},records:data});
  assert.equal(observed.missingCount,1);
  assert.equal(observed.analyzedCount,2);
  assert.deepEqual(observed.result.slope,{numerator:"2",denominator:"1"});
  assert.throws(()=>analyzeStudyStatistics({study:{...protocol,predictor:{name:"x",measurementLevel:"nominal"}},
    records:[{id:"A",predictor:"1",value:"2"},{id:"B",predictor:"2",value:"3"}]}),
    /regression predictor requires/);
});

test("statistical study is a registered operation with an authoritative versioned input schema", () => {
  assert.equal(operationDefinition.name,"analyzeStudyStatistics");
  assert.equal(operationDefinition.inputSchema.$schema,"https://json-schema.org/draft/2020-12/schema");
  assert.equal(operationDefinition.inputSchema.allOf.length,6);
  assert.equal(operationDefinition.outputSchema.properties.scientificReceiving.const,
    "not-independently-received");
  assert.equal(operationDefinition.outputSchema.properties.publicationAuthorized.const,false);
});

test("accessor-backed mutable research inputs are rejected before hashing or measurement", () => {
  let accessed = 0;
  const row = {id:"case-a",get value() { accessed++; return accessed === 1 ? "1" : "900"; }};
  assert.throws(() => analyzeStudyStatistics({
    study:study(),records:[row],
  }), /own data properties/);
  assert.equal(accessed,0);
  let metadataAccessed = 0;
  const sourceMetadata = { ...study().provenance,
    get claimedRevision() { metadataAccessed++; return "changed"; },
  };
  assert.throws(() => analyzeStudyStatistics({
    study:{...study(),provenance:sourceMetadata},records:rows(["2","4"]),
  }), /own data properties/);
  assert.equal(metadataAccessed,0);
});

test("cyclic source records, inherited fields and sparse arrays cannot masquerade as a stable dataset", () => {
  const row={id:"case-a",value:"1"};
  row.self=row;
  assert.throws(() => analyzeStudyStatistics({study:study(),records:[row]}),
    /cyclic data/);
  const inherited=Object.create({id:"case-a"});
  inherited.value="1";
  assert.throws(() => analyzeStudyStatistics({study:study(),records:[inherited]}),
    /plain JSON records/);
  const sparse=Array(2);
  sparse[0]={id:"case-a",value:"1"};
  assert.throws(() => analyzeStudyStatistics({study:study(),records:sparse}),
    /dense finite arrays/);
});
