# Journal Entry — Contra Account Engine

Source:

- `services/journal_entry/contra/normalizer.py`
- `services/journal_entry/contra/solver.py`
- `services/journal_entry/contra/ranking.py`
- `services/journal_entry/contra/engine.py`
- `services/journal_entry/contra/models.py`

## Normalization model

Each canonical line is converted to positive economic nodes:

- positive debit -> debit node
- negative debit -> credit node (red-letter debit)
- positive credit -> credit node
- negative credit -> debit node (red-letter credit)
- both sides present -> net economic side (`debit - credit`)

This keeps one node per line, so every allocation can be traced back to the
original Excel row.

Identity model:

- `internal_line_key` is derived from a length-prefixed `sheet_name` + `source_row`
  and is unique within a workbook.
- Node ids use `internal_line_key:economic_side`.
- External `line_id` is retained for display and business identity, but may
  repeat across real rows.
- Allocations preserve both identities:
  - `source_internal_key`, `target_internal_key` for machine identity
  - `source_line_id`, `target_line_id` for business/display identity

The original gross amounts are preserved on `NormalizedNode`:

```text
original_debit
original_credit
original_amount   # net amount, kept for compatibility
```

`amount` is the economic amount used by the solver. A both-side line such as
Debit 100 / Credit 40 therefore exposes:

```text
economic_side   = debit
amount          = 60.00
original_debit  = 100.00
original_credit = 40.00
converted       = true
```

Warnings include:

- `negative_amount_normalized`
- `both_sides_netted`
- `zero_line_skipped`
- `same_account_on_both_sides`
- `rounding_residual`
- `unbalanced_voucher`

## Supported voucher shapes

- 1 debit / 1 credit
- 1 debit / N credits
- N debits / 1 credit
- N debits / M credits
- negative debit / negative credit
- same account on both sides (warning only; no semantic ranking penalty yet)
- duplicate identical lines
- duplicate external line ids on different source rows
- zero lines
- 0.01 rounding residual
- unbalanced voucher (partial result)

## Allocations and invariants

`ContraAllocation` contains:

- `source_internal_key`, `source_line_id`, `source_side`
- `target_internal_key`, `target_line_id`, `target_side`
- `amount` (Decimal, serialized as string)
- `method`
- `source_node_id`, `target_node_id`
- `confidence` (only when mathematically justified)

`UnallocatedAmount` also carries `internal_line_key` alongside `line_id` and
`node_id`, so a remaining amount can be traced to the exact source row even when
external line ids repeat.

For a balanced voucher:

- every normalized debit node's outgoing amounts equal its node amount;
- every normalized credit node's incoming amounts equal its node amount;
- the sum of all allocation amounts equals total debit = total credit;
- all allocation amounts are non-negative.

The solver uses integer minor units (cents), so conservation is exact.

## Solver

1. Drop zero nodes.
2. If debit and credit totals differ, add a virtual node on the deficient side.
3. Reject the search with `complexity_limited` if node count exceeds
   `max_nodes`.
4. Iterative deepening on edge count:
   - minimum = `max(number of debit nodes, number of credit nodes)`
   - maximum = `n + m - 1` (transportation-problem basic solution bound)
5. For each debit, generate candidate allocations by filling whole credit
   buckets plus at most one partial bucket. This covers transportation extreme
   points without enumerating every cent split.
6. Deduplicate solutions by a canonical edge signature.
7. Stop at `max_solutions` or `max_search_states`.

Defaults (`SolverConfig`):

- `max_nodes = 24`
- `max_solutions = 200`
- `max_search_states = 200_000`

If the guard is hit:

- `complexity_limited = true` for node/search limits;
- `solution_limit_reached = true` for the solution cap;
- found solutions are still returned and ranking still runs.

## Ranking

`rank_solutions()` is deterministic and explainable:

1. fewer allocation edges;
2. fewer split nodes;
3. lexical canonical edge signature.

No machine learning, semantic score, random tie-break, or hash-order iteration
is used.

## Confidence / ambiguity

- `confidence = "1.00"` only when:
  - exactly one minimal-edge solution was found;
  - no limit was reached;
  - no unallocated amount remains; and
  - the voucher is one-sided (1:1, 1:N, N:1), where global uniqueness is
    provable from conservation.
- `confidence = null` for N:M vouchers even when only one minimal-edge solution
  is found. A unique minimum-edge solution does not prove that no alternative
  solution with more edges exists.
- Otherwise `confidence = null`.
- `ambiguous = solution_count > 1`.
- `solution_count` is the number of minimal-edge solutions found up to
  `max_solutions`; it is not a claim about every possible cent-level split.

## Unbalanced vouchers

The solver inserts a virtual balancing node, then removes virtual edges from the
result. The remaining actual edges are a valid partial allocation, and the
unallocated amount is reported in `unallocated_debit` / `unallocated_credit`.
Unbalanced vouchers never crash the engine.

## Determinism

- Node ids derive from `internal_line_key`, never external `line_id`.
- Node ordering: amount descending, then node id.
- Candidate allocation ordering: subset size, subset indices, partial index.
- Solutions deduplicated by a tuple signature containing internal node ids.
- Ranking ties broken by canonical signature.
- Repeated runs produce identical `to_dict()` output.

Duplicate external `line_id` values therefore cannot collapse source rows or
make an ambiguous result appear unique. Confidence still follows the original
rule: `"1.00"` only when exactly one solution was found, no limit was triggered,
and no unallocated amount remains.

## Known limitation

Same-account contra relationships are currently allowed and reported with
`same_account_on_both_sides`. No semantic ranking penalty is applied in this
phase. A future phase may add one, but it must remain separately tested and
documented.

## External algorithm reuse

The external `Accounting-Entry-Test` project was read as an algorithmic
reference (Sink-Source normalization, exhaustive/iterative allocation, Occam
ranking). This implementation was rewritten for the canonical schema.

- `REIMPLEMENTED IDEA`: negative-direction normalization, multi-line
  allocation, complexity-bounded search, fewer-edge ranking.
- `DIRECTLY REUSED CODE`: none.
- `NOT USED`: Streamlit UI, pandas DataFrame coupling, Windows launcher,
  session state, debug print, and the external model/anomaly stack.

The external ZIP supplied for this task contains no `LICENSE` file. No material
source code was copied. Any future direct copying or close adaptation requires
`LICENSE REVIEW REQUIRED`.
