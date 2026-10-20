# Journal Entry — Phase 2 Anomaly Engine

Source: `services/journal_entry/anomaly/`.

Phase 2 is a pure Python, deterministic, rule-based anomaly engine.

It consumes canonical `JournalEntry` objects from Phase 1 and never reads
Excel, maps columns, regroups vouchers, writes PostgreSQL, or calls the network.

## Input contract

```python
analyze_anomalies(
    entries: list[JournalEntry] | JournalEntry,
    contra_results: Mapping[str, ContraAnalysisResult] | None = None,
    config: AnomalyConfig | None = None,
) -> AnomalyResult
```

- `entries` are already normalized vouchers.
- `contra_results` is optional and keyed by `voucher_key_for_entry(entry)`.
- Missing contra results do not block anomaly analysis.
- Duplicate `voucher_key` values raise `ValueError`; population identity must be
  unambiguous.

`score_entries(entries, context=...)` contract:

```text
entries = scoring target
context = statistical reference population
```

If a context is supplied, only the requested `entries` are scored; their
baseline statistics still come from `context`. The context is not mutated.

## Population and baseline scope

V1 population:

```text
all entries supplied to one analyze_anomalies() call
```

No historical data, cross-job data, database, or per-user baseline is used.

Baseline key, in priority order:

```text
entity + period  -> entity_period|<entity>|<period>
entity only      -> entity|<entity>|
period only      -> period||<period>
neither          -> global||
```

There is **no cross-entity statistical fallback in V1**.

If entity A has 12 vouchers and entity B has 12 vouchers, each baseline stays
at 12 and frequency remains disabled for both. The engine does not merge them
into a 24-voucher global baseline.

If a requested voucher is outside the supplied context population, it receives
an explicitly disabled empty baseline (population 0), not the global baseline.

Frequency-based rules are disabled when the relevant baseline population is
smaller than `min_population_for_frequency` (default `20`).

## Account categories

`grouping.py` classifies each account by:

1. four-digit account-code prefix (preferred);
2. Chinese account-name keyword fallback;
3. `unknown`.

Categories include:

```text
cash_bank, receivable, prepaid, inventory, fixed_asset, intangible,
long_term_deferred, payable, advance_receipt, payroll, tax, equity,
revenue, other_income, cost, expense, loan, investment, profit, unknown
```

Unknown accounts remain visible through `unknown_account_count` and
`unknown_account_ratio`; they are not silently treated as normal.

## Business groups

V1 groups:

```text
cash_bank_transfer
revenue_receipt
purchase_payment
expense_payment
payroll
tax
asset_acquisition
financing
equity
other
```

Classification is ordered rule-based:

- payroll category
- asset debit + cash/payable/loan credit
- equity credit + cash debit
- loan + cash
- revenue credit + receivable/cash/advance receipt debit
- inventory/cost debit + cash/payable/loan credit
- expense debit + cash/payable/payroll credit
- tax with cash/payable/expense
- cash on both sides / cash-only
- otherwise `other`

Description keywords are not used as a primary signal. No clustering or ML is
used.

## Feature model

`features.py` extracts one `VoucherFeatures` per voucher:

- voucher/date/period/entity identity
- total debit/credit and gross amount
- line count, account count, account lists
- set-based `account_signature`
- directional `D:...|C:...` signature
- multiset signature for duplicate account rows
- account categories, unknown counts/ratio
- negative/mixed-side flags
- exact balance / tolerance flags
- validation flags
- optional contra ambiguity/unallocated/solution count/warnings
- source sheet names and rows

Gross amount definition:

```text
gross_amount = max(abs(total_debit), abs(total_credit))
```

This equals either side for a normal positive balanced voucher and avoids
double-counting `debit + credit`.

## Frequency model

Each baseline precomputes, in one pass:

- directional signature counts
- unordered account-combination counts
- directional account-pair counts (`D:<debit>->C:<credit>`)
- gross amount list
- line-count list
- business-group category profiles
- signature/combination diversity

Percentile rank uses a deterministic mid-rank:

```text
(count_less + 0.5 * count_equal) / n
```

Ties therefore receive the same percentile. Amount percentiles and within-group
positions use this function.

## Rarity

Rarity is no longer a single ratio rule. It separates three evidence types:

```text
directional account pair
unordered account combination
full directional voucher signature
```

Each evidence type uses both:

```text
absolute occurrence count
relative occurrence ratio
```

### Absolute count bands

```text
count <= 1   -> 1.00
count <= 3   -> 0.75
count <= 5   -> 0.50
count <= 10  -> 0.25
count > 10   -> 0.00
```

The bands are configuration values, not scattered magic numbers.

### Ratio strength

```text
ratio >= rare_ratio -> 0
ratio < rare_ratio  -> (rare_ratio - ratio) / rare_ratio
```

Default `rare_ratio = 0.10`.

For each evidence type:

```text
strength = min(count_strength, ratio_strength) * diversity_factor
```

This prevents a count of 100 from being called rare only because its ratio is
below 10% in a large ledger.

### Subcomponent weights

```text
pair rarity         0..20
combination rarity  0..10
signature rarity    0..5
rarity total        0..35 (sum, capped)
```

Pair rarity is intentionally weighted above full-signature rarity. A unique
multi-line signature whose constituent directional pairs are common is much
weaker evidence than a genuinely rare directional account relationship.

Pair keys are directional:

```text
D:<debit_account>->C:<credit_account>
```

### Diversity guards

```text
signature diversity      affects only signature rarity
combination diversity    affects only combination rarity
pair diversity           affects only pair rarity
```

Defaults:

```text
max_signature_diversity   = 0.50
max_combination_diversity = 0.50
max_pair_diversity        = 0.80
```

The pair guard prevents an all-unique synthetic population from making every
voucher pair-rare, while real ledgers with low pair diversity keep pair
evidence active.

Rarity is disabled entirely when the baseline population is below
`min_population_for_frequency`.

## Cross-group anomaly

Requires:

- assigned group is not `other`;
- baseline population and assigned group size >= `min_group_size` (default 5);
- the group has typical categories (frequency >= 0.50);
- unknown account ratio is not above 50%.

It compares the voucher's category set against:

- assigned group typical categories (coverage);
- every other eligible group's typical categories (nearest coverage).

```text
mismatch    = 1 - assigned_coverage
divergence  = max(0, nearest_coverage - assigned_coverage)
strength    = clamp(0.5 * mismatch + 0.5 * divergence)
score       = 25 * strength
```

This is a category-profile distance, not a clustering distance.

## Within-group anomaly

Requires group size >= `min_group_size`.

Uses percentile position inside the assigned group for:

- gross amount (70% weight)
- line count (30% weight)

Only the top decile contributes:

```text
high_strength = clamp((percentile - 0.90) / 0.10)
score = 20 * (0.7 * amount_high + 0.3 * line_high)
```

No normal-distribution assumption. Ties are conservative via mid-rank percentile.

## Materiality

Materiality uses the baseline population:

```text
amount_percentile = mid-rank percentile
share             = gross_amount / baseline_total_gross
percentile_high   = clamp((percentile - 0.95) / 0.05)
share_high        = clamp(share / 0.10)
strength          = 0.5 * percentile_high + 0.5 * share_high
score             = 20 * strength
```

Materiality is evidence and a score component, not a conclusion.

**Materiality alone never creates a finding**:
`JE-A005` is emitted only when the materiality component is >= 10 and at least
one of rarity/cross-group/within-group is non-zero.

## Score components

```text
rarity         0..35
  pair           0..20
  combination    0..10
  signature      0..5
cross_group    0..25
within_group   0..20
materiality    0..20
total          0..100
```

All scores use `Decimal`, quantized to `0.01`.

## Severity and finding threshold

```text
HIGH   >= 75
MEDIUM >= 35
LOW    >= 20
INFO   <  20
```

Findings are created only when total risk score >= `20`.

Stable codes and independent triggers:

```text
JE-A001  unusual_account_combination
         pair strength >= 0.50 OR combination strength >= 0.50
         Evidence: directional pair + combination only

JE-A002  rare_voucher_signature
         signature count <= 3 AND signature strength >= 0.50
         Evidence: signature only

JE-A003  cross_group_anomaly
         cross-group strength >= 0.25

JE-A004  within_group_outlier
         within-group strength >= 0.50

JE-A005  material_amount
         materiality score >= 10
         + at least one other non-zero signal
```

A001 and A002 can overlap, but they no longer share one trigger or one
evidence blob.

## Summary contract

`AnomalyResult.summary` separates finding counts, voucher risk levels, and
baseline readiness:

```json
{
  "voucher_count": 1674,
  "scored_voucher_count": 1674,
  "finding_count": 390,
  "finding_voucher_count": 171,
  "review_rate": "0.102151",
  "finding_severity_counts": {
    "HIGH": 5,
    "MEDIUM": 162,
    "LOW": 223,
    "INFO": 0
  },
  "voucher_risk_level_counts": {
    "HIGH": 1,
    "MEDIUM": 53,
    "LOW": 117,
    "INFO": 1503
  },
  "rarity_positive_voucher_count": 431,
  "pair_rarity_positive_voucher_count": 254,
  "combination_rarity_positive_voucher_count": 407,
  "signature_rarity_positive_voucher_count": 431,
  "baseline_count": 2,
  "frequency_enabled_baseline_count": 0,
  "frequency_disabled_baseline_count": 2,
  "frequency_enabled_for_all": false,
  "frequency_enabled_for_any": false
}
```

`review_rate = finding_voucher_count / scored_voucher_count`.

Warnings:

```text
frequency_disabled_all_baselines
frequency_disabled_for_some_baselines
high_signature_diversity_scaled
high_review_rate
```

`high_review_rate` is emitted when `review_rate` exceeds the configurable
`high_review_rate_warning_threshold` (default `0.50`). It is diagnostic only and
does not suppress or quota findings.

## Real-ledger calibration (aggregate)

```text
metric                  before      after
finding vouchers         1,226        171
review rate            0.732378   0.102151
JE-A001                  1,226        159
JE-A002                  1,226        134
JE-A003                    164         37
JE-A004                     61         49
JE-A005                     11         11
finding HIGH                  5          5
finding MEDIUM              674        162
finding LOW               2,009        223
voucher HIGH                  1          1
voucher MEDIUM              268         53
voucher LOW                 957        117
voucher INFO                448      1,503
rarity-positive           1,449        431
```

Before voucher risk levels were not exposed by the old summary and were
reconstructed from the pre-calibration rarity formula for comparison.

Why the count changed:

- signatures/pairs appearing more than 10 times no longer contribute count-based rarity
- ratio alone cannot make a 30–100 occurrence pattern rare
- pair rarity is weighted above full-signature rarity
- full-signature rarity is downweighted when constituent evidence is common
- A001 and A002 now have independent thresholds and evidence

## Rarity distribution after calibration

Voucher counts by full-signature occurrence band:

```text
signature count band    vouchers    count strength
1                            96       1.00
2-3                         116       0.75
4-5                          83       0.50
6-10                        136       0.25
11-20                       237       0.00
21-50                       337       0.00
51-100                      211       0.00
>100                        458       0.00
```

Rarity-positive vouchers occur only in the `1`, `2-3`, `4-5`, and `6-10`
bands.

## Small-sample and diversity guards

- frequency rules off below 20 vouchers in the baseline
- within/cross-group rules off below 5 vouchers in a group
- rarity scaled down when signature/combination/pair diversity is high
- absolute count bands suppress patterns occurring more than 10 times
- all-unique datasets do not make every voucher high risk
- materiality alone does not create a finding

## Determinism

- no random UUIDs
- finding id = `code + sha256(code|voucher_key)[:16]`
- order:
  - scores: risk score descending, voucher key ascending
  - findings: risk score descending, voucher key ascending, code ascending
- no set/dict iteration drives output
- repeated runs and shuffled input order produce identical `to_dict()` output

## Known limitations

- Business groups are coarse V1 rules, not a learned taxonomy.
- Signature/pair rarity uses the full canonical account key. Overly granular
  account codes can create spurious rarity; the absolute count bands and
  diversity guards reduce but do not eliminate this.
- The real ledger has no entity/period columns, so the anomaly baseline is
  `global||`.
- Real-ledger finding volume is improved but remains a screening signal, not an
  audit conclusion.
- `other` group does not participate in cross-group distance.
- Unknown account categories may prevent or weaken group comparison.
- No historical baseline; only the current call population is used.
- No industry, entity-size, or materiality planning baseline.
- No anomaly rule for true accounting fraud, journal approval, user behavior,
  weekend posting, or manual journal flags.
- `professional_interpretation` is always `None`; interpretation belongs to a
  later accounting-advisor layer.
- No Node API, worker, status file, export, DB, or frontend in this phase.

## External algorithm reference

The external `Accounting-Entry-Test` project was read as an algorithmic
reference only.

```text
REIMPLEMENTED IDEA
- business-group thinking
- account-combination/frequency features
- within/cross-group anomaly ideas
- materiality as a separate signal

DIRECTLY REUSED CODE
- None.

NOT USED
- pandas/NumPy pipeline
- sklearn/ML classifier
- Streamlit UI
- external data processor and cluster engine implementation
- model downloads / network / LLM
```

No material source code was copied from the external package.
