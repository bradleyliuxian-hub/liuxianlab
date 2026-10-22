'use strict';

/*
 * Aggregate batch summary from completed child summary_json only.
 *
 * This never reads result.json files and never re-runs accounting analysis.
 * Rates are weighted by summed numerators/denominators, not averaged across
 * child percentages.
 */

const SUMMARY_FIELDS = {
  rawRowCount: 'raw_row_count',
  lineCount: 'line_count',
  voucherCount: 'voucher_count',
  issueCount: 'issue_count',
  unbalancedVoucherCount: 'unbalanced_voucher_count',
  businessClassifiedCount: 'business_classified_count',
  businessVoucherCount: 'business_voucher_count',
  findingCount: 'finding_count',
  findingVoucherCount: 'finding_voucher_count'
};

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function rate(numerator, denominator) {
  if (!finite(numerator) || !finite(denominator) || denominator <= 0) {
    return null;
  }
  return (numerator / denominator).toFixed(6);
}

function aggregateCompletedSummaries(jobs, { totalFileCount } = {}) {
  const completed = (Array.isArray(jobs) ? jobs : [])
    .filter((job) => job && job.status === 'completed');
  const summaries = completed.map((job) => (
    job.summaryJson && typeof job.summaryJson === 'object'
      ? job.summaryJson
      : null
  ));

  const totals = {};
  const available = {};
  for (const [publicName, sourceName] of Object.entries(SUMMARY_FIELDS)) {
    const complete = summaries.length > 0
      && summaries.every((summary) => summary && finite(summary[sourceName]));
    available[publicName] = complete;
    totals[publicName] = complete
      ? summaries.reduce((sum, summary) => sum + summary[sourceName], 0)
      : null;
  }

  return {
    completedFileCount: completed.length,
    totalFileCount: Number.isInteger(totalFileCount)
      ? totalFileCount
      : completed.length,
    ...totals,
    businessCoverage: rate(
      available.businessClassifiedCount ? totals.businessClassifiedCount : null,
      available.voucherCount ? totals.voucherCount : null
    ),
    reviewRate: rate(
      available.findingVoucherCount ? totals.findingVoucherCount : null,
      available.voucherCount ? totals.voucherCount : null
    ),
    available
  };
}

module.exports = { aggregateCompletedSummaries };
