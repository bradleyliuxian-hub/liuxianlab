'use strict';

const BRANCH_MARKERS = ['分公司', '分店', '办事处', '营业部', '支行', '门店', '直营网点', '服务部'];
const LEGAL_SUFFIXES = [
  '股份有限公司',
  '有限责任公司',
  '集团有限公司',
  '有限公司',
  '集团',
  '公司',
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s·•・,，。.;；:：'"“”‘’()（）\[\]【】{}<>《》\/\\_-]+/g, '');
}

function stripLegalSuffix(value) {
  let text = normalizeText(value);
  for (const suffix of LEGAL_SUFFIXES) {
    const normalizedSuffix = normalizeText(suffix);
    if (text.endsWith(normalizedSuffix) && text.length > normalizedSuffix.length) {
      text = text.slice(0, -normalizedSuffix.length);
      break;
    }
  }
  return text;
}

function markerSet(value) {
  const normalized = normalizeText(value);
  return new Set(BRANCH_MARKERS.filter((marker) => normalized.includes(normalizeText(marker))));
}

function bigrams(value) {
  const text = normalizeText(value);
  if (text.length <= 1) return new Set(text ? [text] : []);
  const set = new Set();
  for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2));
  return set;
}

function diceCoefficient(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

function regionBonus(inputRegion, candidate) {
  if (!inputRegion) return 0;
  const region = normalizeText(inputRegion);
  const haystack = normalizeText(
    `${candidate.province || ''}${candidate.city || ''}${candidate.district || ''}${candidate.address || ''}`
  );
  return region && haystack.includes(region) ? 0.04 : -0.04;
}

function regionMatches(inputRegion, candidate) {
  if (!inputRegion) return true;
  const region = normalizeText(inputRegion);
  const haystack = normalizeText(
    `${candidate.province || ''}${candidate.city || ''}${candidate.district || ''}${candidate.address || ''}`
  );
  return Boolean(region) && haystack.includes(region);
}

function branchPenalty(inputName, candidateName) {
  const inputMarkers = markerSet(inputName);
  const candidateMarkers = markerSet(candidateName);
  if (inputMarkers.size === candidateMarkers.size && [...inputMarkers].every((x) => candidateMarkers.has(x))) {
    return 0;
  }
  if (inputMarkers.size === 0 && candidateMarkers.size > 0) return -0.14;
  return -0.08;
}

function scoreCandidate(input, candidate) {
  const inputFull = normalizeText(input.companyName);
  const candidateFull = normalizeText(candidate.name);
  if (!inputFull || !candidateFull) return 0;

  if (inputFull === candidateFull) {
    return Math.min(1, 0.98 + regionBonus(input.region, candidate));
  }

  const inputBase = stripLegalSuffix(input.companyName);
  const candidateBase = stripLegalSuffix(candidate.name);
  const fullDice = diceCoefficient(inputFull, candidateFull);
  const baseDice = diceCoefficient(inputBase, candidateBase);
  let score = 0.58 * fullDice + 0.34 * baseDice;

  if (inputFull.includes(candidateFull) || candidateFull.includes(inputFull)) score += 0.06;
  if (inputBase && inputBase === candidateBase) score += 0.08;
  score += branchPenalty(input.companyName, candidate.name);
  score += regionBonus(input.region, candidate);

  return Math.max(0, Math.min(1, score));
}

function rankCandidates(input, candidates) {
  return candidates
    .map((candidate) => ({ ...candidate, matchScore: Number(scoreCandidate(input, candidate).toFixed(4)) }))
    .sort((a, b) => b.matchScore - a.matchScore);
}

function classifyMatch(input, candidates, config) {
  const ranked = rankCandidates(input, candidates).slice(0, config.returnedCandidateLimit);
  if (ranked.length === 0) {
    return { status: 'not_found', match: null, candidates: [], confidence: 0 };
  }

  const top = ranked[0];
  const runnerUp = ranked[1];
  const margin = runnerUp ? top.matchScore - runnerUp.matchScore : 1;
  const exact = normalizeText(input.companyName) === normalizeText(top.name);
  const regionOK = regionMatches(input.region, top);

  if (regionOK && (exact || (top.matchScore >= config.autoAcceptThreshold && margin >= 0.08))) {
    return { status: 'matched', match: top, candidates: ranked, confidence: top.matchScore };
  }

  if (top.matchScore >= config.reviewThreshold) {
    return { status: 'review', match: null, candidates: ranked, confidence: top.matchScore };
  }

  return { status: 'not_found', match: null, candidates: ranked, confidence: top.matchScore };
}

module.exports = {
  normalizeText,
  stripLegalSuffix,
  scoreCandidate,
  rankCandidates,
  classifyMatch,
  regionMatches,
};
