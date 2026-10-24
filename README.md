# @red-cup-engineering/research-claim-reproduction-service

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

Check every number in your paper. A paper states numbers in prose: sums of
series, shares to two decimals, a sensitivity run with one assumption changed,
the length of a list, whether some record in a register has some state. This
service recomputes each one from the paper's source records, in exact decimal
arithmetic, and reports for every claim the stated value, the derived value, and
whether they agree. It then projects the tables the paper prints (CSV and Pandoc
pipe tables) from the same records, so the printed numbers are the computed ones.

The paper's repository holds **data only**: its records, and a JSON *claim-spec*
that says which claim derives from what. All code is here, generic and
deterministic, so a Science repository needs no Python, no scripts, and no
supply chain beyond one devDependency.

Intended seat in the Group tree: `computer-documents-engineering-services-section/services/research-claim-reproduction-service`
(beside `research-release-metadata-service` and `research-paper-authoring-service`).

## Use it from a paper repository

```sh
npm install --save-dev @red-cup-engineering/research-claim-reproduction-service
npx reproduce-paper-claims --root . --spec claims/claims.json          # write outputs; exit 1 on any disagreement
npx reproduce-paper-claims --root . --spec claims/claims.json --check  # write nothing; exit 1 on disagreement or drift
```

`claims/claims.json` lists the records and claims; its `tables` member may name a
sibling file (`"tables": "tables.json"`) holding tables, documents and any extra
bindings. A Makefile or CI step is one line; the process exit status is the gate.

| Exit | Meaning |
| --- | --- |
| 0 | every claim agrees (and, with `--check`, every output file is byte-identical) |
| 1 | a claim disagrees, or an output file differs from what the records produce |
| 2 | the spec, a record or a path was refused (malformed, unreadable, outside the root) |

Nothing is read or written outside `--root`; a record or output path with `..`,
an absolute path, a backslash, or a symlink that leaves the root is refused.

## The claim-spec language

Schema: [`schemas/claim-spec.schema.json`](schemas/claim-spec.schema.json)
(JSON Schema 2020-12; also exported as `./claim-spec.schema.json`). A spec is
JSON:

```json
{
  "specVersion": "1",
  "records": { "births": "data/records/births.json" },
  "bindings": {
    "annual":  { "record": "births", "path": "/annual",
                 "groupBy": { "key": "/year", "value": "/thousands", "width": 10, "scale": 1000,
                              "require": { "from": 1800, "to": 1859 } } },
    "early":   { "record": "births", "path": "/captive", "slice": [1, 6] }
  },
  "claims": [
    { "id": "early-total", "manuscript": "03-results", "stated": 5167522,
      "expression": { "sum": { "ref": "early" } }, "basis": "sum of decades 1800-1849" }
  ],
  "resultsPath": "data/derived/claims.json",
  "tables": [ ... ], "documents": [ ... ]
}
```

**Values and exactness.** Numbers are exact decimals (an unscaled BigInt and a
scale); no binary float takes part in any sum, product, quotient or rounding.
`percent` rounds exactly, half-even by default or `half-up` (ties away from
zero). Records read from disk keep every number literal exactly, trailing zeros
included. A decimal with a fractional part is written to JSON as a **string**
(`"17.20"`), an integer as a number. Write stated decimals as strings.

**agrees** is string equality of the canonical text of the stated and derived
values (numbers by decimal text, strings as themselves, booleans as `true` /
`false`). `"17.20"` agrees with a derived `17.20` and not with `"17.2"`.

**Bindings** name values. A *source* binding selects `path` (a JSON Pointer) in a
named record, then optionally `groupBy` (sum `value` by `floor(key / width) *
width`, ascending, times `scale`; `require: {from, to}` demands every integer key
exactly once; an empty interior group is refused), then optionally `slice`
(half-open `[start, end)`, out-of-range refused). Any other binding is an
expression. Bindings are lazy, memoized, and cycle-checked.

**Expressions** are scalars (literals), arrays (each element evaluated), or an
object with exactly one operator key:

| Operator | Meaning |
| --- | --- |
| `{"literal": v}` | `v` unevaluated; numbers become exact decimals |
| `{"ref": name}` | loop/`let` variable, else a binding; tables also see `claimResults` |
| `{"pointer": {"record", "path"}}` | value at a JSON Pointer in a record |
| `{"get": {"from", "key", "default"?}}` | array element by integer, object member by string |
| `sum`, `add`, `multiply`, `subtract` | exact arithmetic |
| `{"floorDivide": {"numerator", "denominator"}}` | integer floor of the exact quotient |
| `{"percent": {"numerator", "denominator", "places", "rounding"?}}` | `100 * n / d`, rounded exactly |
| `{"count": {"array", "where"?}}` | length, or number of matching elements |
| `{"slice": {"array", "start", "end"?}}`, `{"substitute": {"array", "index", "value"}}`, `concat`, `{"range": {"start", "step", "count"}}` | array construction; `substitute` is the one-element sensitivity variant |
| `{"map": {"over", "as", "index"?, "to"}}` | evaluate `to` per element |
| `{"any" \| "all" \| "find": {"array", "where"}}` | boolean tests; `find` requires exactly one match |
| `{"format": {"value", "places"?, "rounding"?, "group"?, "booleans"?}}` | text: rounded, thousands-grouped, boolean labels |
| `normalize`, `text`, `substring`, `equals`, `{"if": {"cond", "then", "else"}}` | trailing-zero strip (never an exponent), concatenation, code-point substring, deep equality, conditional |

`where` is `{field: {startsWith | equals | notEquals: expression}}`; field is a
member name or a `/`-pointer, all predicates must hold, and a missing field is a
refusal. Evaluation has a step budget (1,000,000 evaluations plus array elements
built); `range` is capped at 100,000.

**Claims** are `{id, manuscript, stated, expression, basis}`. Every field except
`expression`'s result is itself an expression, so ids and bases can be built from
data. `forEach: [{over, as, index?}, ...]` expands one entry into one claim per
combination (nested in order), and `let` names intermediate values, so a
sensitivity run over a record's own rows is one entry. Duplicate ids are refused.
A result is `{id, manuscript, stated, derived, agrees, basis}`.

**Tables** are `{id, iterate?, let?, csv?, markdown?}`: one row per element of
`iterate.over`; `csv: {path, columns: [{header, value}], crlfDigest?}`;
`markdown: {caption, label?, columns: [{header, align?, value}]}`. CSV is RFC 4180
with LF line endings (a field with a comma, quote, CR or LF is quoted). Markdown
is a Pandoc pipe table with a `Table: caption {#tbl:id}` line; `|` in a cell is
escaped. **Documents** are `{path, blocks: [{heading}|{paragraph}|{table}]}`
joined by blank lines. `crlfDigest` also reports the digest of the CSV with every
LF replaced by CRLF, for checking legacy release bundles.

## Operations

Every operation is a pure function (effect class **pure**: no filesystem, clock,
network or randomness) and a command that reads one JSON value per input line and
writes one JSON value per output line. A refusal is a thrown `TypeError` or
`RangeError`; the command renders it as
`{"ok":false,"refusal":{"reason":"TypeError","message":"..."}}` and exits 2.

### reproduceStatedClaims

~~~js
export function reproduceStatedClaims({ records, recordTexts, spec }) // -> { results, total, agreed, disagreed, ok }
~~~

- Refusals: `TypeError` for a malformed request, an unknown key, a spec that is not admissible (every problem is listed with its path), a record that is not valid JSON, given twice, or named by the spec and not supplied; `RangeError` for a claim that cannot be evaluated (a pointer that does not resolve, an index or slice out of range, division by zero, `find` without exactly one match, a duplicate claim id, a non-string id, the step budget exceeded).
- Precondition: `spec` is a claim-spec; every record named in `spec.records` is supplied in `records` (parsed JSON) or `recordTexts` (JSON text, number literals read exactly).
- Postcondition: `results` holds one `{id, manuscript, stated, derived, agrees, basis}` per claim in spec order; `agreed` and `total` count them; `disagreed` lists the ids of the claims that disagree; `ok` is true exactly when none does. A disagreement is a result, not a refusal.
- Preserved frame: the records and the spec are not modified; the same input gives the same output.
- Effect class: pure. Witness: the white-repopulation golden test (26 claims, ids, stated, derived, agrees and basis identical to the Python reproduction), exact-arithmetic tests (half-even and half-up ties, negative floors, 0.1 + 0.2 = 0.3, integers beyond 2^53), and a refusal test per operator.
- Command: `reproduce-stated-claims` reads one JSON value per input line and writes one JSON value per output line.

~~~sh
echo '{"records":{"survey":{"respondents":50,"byGroup":[12,30,8]}},"spec":{"specVersion":"1","records":{"survey":"data/survey.json"},"claims":[{"id":"n","manuscript":"02","stated":50,"basis":"sum","expression":{"sum":{"pointer":{"record":"survey","path":"/byGroup"}}}}]}}' | npx reproduce-stated-claims
~~~

Through the command or a market, numbers in `records` arrive as doubles: an
integer beyond 2^53 or a decimal with more than 17 significant digits is not
exact. Send `recordTexts` (JSON text) for those.

### projectDerivedTables

~~~js
export function projectDerivedTables({ records, recordTexts, spec }) // -> { files: [{ path, text, sha256, bytes, variants? }], claims }
~~~

- Refusals: as `reproduceStatedClaims`, plus `RangeError` for a column, caption or block that cannot be evaluated (a non-scalar cell, a multi-line caption, an unresolvable pointer).
- Precondition: as `reproduceStatedClaims`.
- Postcondition: `files` holds, in order, each table's CSV, the claim results JSON (when `resultsPath` is set) and each document; `text` is the file's exact content (UTF-8, LF), `sha256` its lowercase hex digest, `bytes` its UTF-8 length, and `variants.crlf` the digest of the CRLF rendering when the table asks for `crlfDigest`; `claims` is the `{total, agreed, disagreed, ok}` summary, since the claims table of an appendix is computed from the same results.
- Preserved frame: no input is modified; paths are reported, never written.
- Effect class: pure. Witness: byte-identity with the golden CSVs, claims JSON and Pandoc appendix of the white-repopulation paper, the v0.1.0 CRLF digests, RFC 4180 quoting tests, and double-run determinism.
- Command: `project-derived-tables` reads one JSON value per input line and writes one JSON value per output line.

### reproduce-paper-claims (the runner)

~~~sh
reproduce-paper-claims --root <paper repo> --spec claims/claims.json [--check]
~~~

- Refusals: exit 2 with the refusal on standard error for an unreadable or non-JSON spec or record, a path outside the root, or any refusal of the operations.
- Precondition: `--root` is the paper repository; `--spec` is a path inside it.
- Postcondition: every record the spec names is read from the root; `projectDerivedTables` and `reproduceStatedClaims` run on it; every output file is written (to a temporary name, then renamed) or, with `--check`, compared; each disagreement prints `DISAGREES <id>: stated <s> derived <d>` and each drifted file `DRIFT <path>` on standard error; one summary line on standard output.
- Preserved frame: records and the spec are never written; only the paths the spec lists under `resultsPath`, `csv.path` and `documents[].path` are.
- Effect class: filesystem (reads records inside the root; writes the declared outputs inside the root). Not sold: it needs the paper's tree.
- Witness: the golden test runs it on a copy of the paper tree, then `--check`, then edits an output and a record.

## Held market offers

`data/records/offers/<operation>.json` declares one x402 offer for each sold
operation (`reproduce-stated-claims`, `project-derived-tables`) for the House
markets (`x402-bazaar`, `402index`, `house-capability-market`,
`house-seller-catalog`), all `saleStatus: "held"` and sold by the `engineering`
enterprise, gateway `research-claim-reproduction`, ledger account
`Income:Sales:X402:Research-claim-reproduction`, **$0.01 per call**. The same
terms are in `package.json#x-market` (the autosell declaration of
[x402-services-section](https://github.com/red-cup-engineering/x402-services-section)
PR 18); the test `offers.test.mjs` checks the two agree and, with
`X402_AUTOSELL_MODULE=/path/to/x402-services-section/src/package-offers.mjs` and
`HOUSE_LIB_ROOT=/path/to/lib/phezi-ochage`, that autosell derives both offers
from the package alone and `declareOffer` admits them. The hand-written offers
carry the intended-seat `section`; autosell derives
`<enterprise section>/services/<repository>`, so that one field differs until the
package is seated. `test/fixtures/*.schema.json` are copies of the x402 package's
`offer.schema.json` and the autosell `package-market.schema.json`.

## The white-repopulation golden case

`test/fixtures/white-repopulation/` is a snapshot of the paper that this service
generalizes (CC-BY-4.0 data, see its `NOTICE`): its records, its claim-spec
(`claims/claims.json`, `claims/tables.json`, written as data), the outputs its
Python reproduction wrote, and the digests of its v0.1.0 release bundle. The
tests run the runner on a copy and require byte-identical CSVs, claims JSON and
`manuscript/90-appendix-a-tables.md`, and the recorded CRLF digests. Set
`WHITE_REPOPULATION_ROOT` to also `--check` a live working tree.

## Limitations

- Numbers sent as parsed JSON (the command and market faces) are doubles on arrival; use `recordTexts` for exactness beyond 17 significant digits.
- A decimal result is written to JSON as a string; `percent` with `places: 0` therefore writes the number `13`, not the string `"13"`. `agrees` is unaffected because it compares text.
- `normalize` strips trailing zeros and never writes an exponent; Python's `Decimal.normalize()` writes `1E+1` for 10, so a spec that reproduces a Python-era file with such a value differs there by design.
- CSV quotes a field containing CR as well as LF, comma and quote (RFC 4180); Python's `csv.writer` with `lineterminator="\n"` does not quote a bare CR.
- Strings in a claim are compared as text; there is no tolerance. A paper that states "about 17%" cannot be checked, only the number it derives it from.
- The spec language has no user-defined functions and no unbounded recursion by design; claims that need a different method are not expressible.
- The runner follows a symlink inside the root and refuses one that leaves it; it does not guard against a concurrent writer changing a link between check and read.
- The `edge` runtime in the `reproduce-stated-claims` offer is declared, not measured on an edge host: its dependency chain is pure JavaScript with no `node:` imports. `project-derived-tables` uses `node:crypto` and is declared `node`.
- The Appendix A paragraph in the golden fixture still says it was generated by `analysis/reproduce.py`; the golden output is reproduced as it is, and the paper's own text decides when to change it.
