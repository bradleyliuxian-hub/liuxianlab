"""Public anomaly engine API.

The engine consumes canonical JournalEntry objects. It never reads Excel,
regroups vouchers, writes a database, or calls the network.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Dict, List, Mapping, Optional, Sequence, Tuple

from ..schema import JournalEntry, amount_to_string
from .constants import (
    DEFAULT_ANOMALY_CONFIG,
    RULE_CODES,
    RULE_CROSS_GROUP_ANOMALY,
    RULE_MATERIAL_AMOUNT,
    RULE_RARE_VOUCHER_SIGNATURE,
    RULE_UNUSUAL_ACCOUNT_COMBINATION,
    RULE_WITHIN_GROUP_OUTLIER,
    SEVERITIES,
    AnomalyConfig,
)
from .features import extract_all_features
from .frequency import (
    AnomalyContext,
    build_anomaly_context as _build_context_from_features,
)
from .models import (
    AnomalyFinding,
    AnomalyResult,
    VoucherAnomalyScore,
    VoucherFeatures,
    make_stable_finding_id,
)
from .scoring import score_entries as _score_features, score_voucher

ZERO = Decimal("0")


def _as_entries(entries: object) -> Tuple[JournalEntry, ...]:
    if isinstance(entries, JournalEntry):
        return (entries,)
    if entries is None:
        return ()
    return tuple(entries)


def build_anomaly_context(
    entries: object,
    contra_results: Optional[Mapping[str, object]] = None,
    config: Optional[AnomalyConfig] = None,
) -> AnomalyContext:
    features = extract_all_features(
        _as_entries(entries),
        contra_results=contra_results,
    )
    return _build_context_from_features(
        features,
        config=config or DEFAULT_ANOMALY_CONFIG,
    )


def score_entries(
    entries: object,
    context: Optional[AnomalyContext] = None,
    contra_results: Optional[Mapping[str, object]] = None,
    config: Optional[AnomalyConfig] = None,
) -> Tuple[VoucherAnomalyScore, ...]:
    requested = _as_entries(entries)
    if context is None:
        context = build_anomaly_context(
            requested,
            contra_results=contra_results,
            config=config,
        )
        features = context.features
    else:
        features = extract_all_features(
            requested,
            contra_results=contra_results,
        )
    scores = [score_voucher(feature, context) for feature in features]
    scores.sort(key=lambda item: (-item.risk_score, item.voucher_key))
    return tuple(scores)


def _component_evidence(
    score: VoucherAnomalyScore,
    component: str,
) -> Mapping[str, object]:
    return score.evidence["components"][component]["evidence"]


def _component_strength(
    score: VoucherAnomalyScore,
    component: str,
) -> Decimal:
    return Decimal(str(score.evidence["components"][component]["strength"]))


def _base_evidence(
    feature: VoucherFeatures,
    score: VoucherAnomalyScore,
    component: str,
    component_score: Decimal,
    component_evidence: Optional[Mapping[str, object]] = None,
) -> Dict[str, object]:
    return {
        "risk_score": amount_to_string(score.risk_score),
        "risk_level": score.risk_level,
        "baseline_key": score.evidence["baseline_key"],
        "population_size": score.evidence["population_size"],
        "frequency_enabled": score.evidence["frequency_enabled"],
        "business_group": feature.business_group,
        "account_signature": feature.account_signature,
        "directional_signature": feature.directional_signature,
        "gross_amount": amount_to_string(feature.gross_amount),
        "components": {
            key: amount_to_string(value)
            for key, value in sorted(score.components.items())
        },
        "component": component,
        "component_score": amount_to_string(component_score),
        "component_evidence": (
            component_evidence
            if component_evidence is not None
            else _component_evidence(score, component)
        ),
    }


def _make_finding(
    code: str,
    type_name: str,
    reason: str,
    feature: VoucherFeatures,
    score: VoucherAnomalyScore,
    component: str,
    component_evidence: Optional[Mapping[str, object]] = None,
) -> AnomalyFinding:
    component_score = score.components[component]
    return AnomalyFinding(
        id=make_stable_finding_id(code, feature.voucher_key),
        code=code,
        type=type_name,
        severity=score.risk_level,
        risk_score=score.risk_score,
        voucher_key=feature.voucher_key,
        voucher_id=feature.voucher_id,
        date=feature.date,
        period=feature.period,
        entity=feature.entity,
        amount=feature.gross_amount,
        accounts=feature.all_accounts,
        account_signature=feature.account_signature,
        business_group=feature.business_group,
        reason=reason,
        evidence=_base_evidence(
            feature,
            score,
            component,
            component_score,
            component_evidence,
        ),
        sheet_names=feature.sheet_names,
        source_rows=feature.source_rows,
        professional_interpretation=None,
    )


def _findings_for(
    feature: VoucherFeatures,
    score: VoucherAnomalyScore,
    config: AnomalyConfig,
) -> List[AnomalyFinding]:
    if score.risk_score < config.finding_threshold:
        return []

    findings = []
    rarity_evidence = _component_evidence(score, "rarity")
    pair_strength = Decimal(str(rarity_evidence.get("pair_strength", "0")))
    combination_strength = Decimal(
        str(rarity_evidence.get("combination_strength", "0"))
    )
    signature_strength = Decimal(
        str(rarity_evidence.get("signature_strength", "0"))
    )
    signature_count = int(rarity_evidence.get("signature_count", 0) or 0)
    cross_strength = _component_strength(score, "cross_group")
    within_strength = _component_strength(score, "within_group")
    materiality_score = score.components["materiality"]
    other_signal = (
        score.components["rarity"] > ZERO
        or score.components["cross_group"] > ZERO
        or score.components["within_group"] > ZERO
    )

    if (
        pair_strength >= config.a001_pair_strength_threshold
        or combination_strength >= config.a001_combination_strength_threshold
    ):
        findings.append(
            _make_finding(
                RULE_UNUSUAL_ACCOUNT_COMBINATION,
                "unusual_account_combination",
                "该凭证的科目组合或方向性科目关系在当前基线下出现频率极低。",
                feature,
                score,
                "rarity",
                {
                    "pair": rarity_evidence.get("pair_evidence"),
                    "combination": rarity_evidence.get("combination_evidence"),
                },
            )
        )

    if (
        signature_count <= config.a002_max_signature_count
        and signature_strength >= config.a002_signature_strength_threshold
    ):
        findings.append(
            _make_finding(
                RULE_RARE_VOUCHER_SIGNATURE,
                "rare_voucher_signature",
                "该凭证的完整借贷科目签名在当前基线下出现次数极低。",
                feature,
                score,
                "rarity",
                {
                    "signature": rarity_evidence.get("signature_evidence"),
                },
            )
        )

    if cross_strength >= config.cross_group_finding_strength:
        findings.append(
            _make_finding(
                RULE_CROSS_GROUP_ANOMALY,
                "cross_group_anomaly",
                "该凭证的科目类别结构与同业务组的典型模式存在明显偏离。",
                feature,
                score,
                "cross_group",
            )
        )

    if within_strength >= config.within_group_finding_strength:
        findings.append(
            _make_finding(
                RULE_WITHIN_GROUP_OUTLIER,
                "within_group_outlier",
                "该凭证的金额或行数在同业务组中处于极端位置。",
                feature,
                score,
                "within_group",
            )
        )

    if materiality_score >= config.materiality_finding_score and other_signal:
        findings.append(
            _make_finding(
                RULE_MATERIAL_AMOUNT,
                "material_amount",
                "该凭证金额具有较高重要性，且同时存在其他异常信号。",
                feature,
                score,
                "materiality",
            )
        )

    return findings


def _summary(
    features: Sequence[VoucherFeatures],
    scores: Sequence[VoucherAnomalyScore],
    findings: Sequence[AnomalyFinding],
    context: AnomalyContext,
) -> Dict[str, object]:
    finding_severity_counts = {severity: 0 for severity in SEVERITIES}
    for finding in findings:
        finding_severity_counts[finding.severity] = (
            finding_severity_counts.get(finding.severity, 0) + 1
        )

    voucher_risk_level_counts = {severity: 0 for severity in SEVERITIES}
    for score in scores:
        voucher_risk_level_counts[score.risk_level] = (
            voucher_risk_level_counts.get(score.risk_level, 0) + 1
        )

    code_counts = {code: 0 for code in RULE_CODES}
    for finding in findings:
        code_counts[finding.code] = code_counts.get(finding.code, 0) + 1

    enabled_count = sum(
        1
        for baseline in context.baselines.values()
        if baseline.frequency_enabled
    )
    disabled_count = len(context.baselines) - enabled_count
    finding_vouchers = {finding.voucher_key for finding in findings}
    scored_count = len(scores)
    review_rate = (
        Decimal(len(finding_vouchers)) / Decimal(scored_count)
        if scored_count
        else Decimal("0")
    ).quantize(Decimal("0.000001"))

    rarity_positive = 0
    pair_rarity_positive = 0
    combination_rarity_positive = 0
    signature_rarity_positive = 0
    for score in scores:
        rarity_evidence = _component_evidence(score, "rarity")
        if score.components["rarity"] > ZERO:
            rarity_positive += 1
        if Decimal(str(rarity_evidence.get("pair_strength", "0"))) > ZERO:
            pair_rarity_positive += 1
        if Decimal(str(rarity_evidence.get("combination_strength", "0"))) > ZERO:
            combination_rarity_positive += 1
        if Decimal(str(rarity_evidence.get("signature_strength", "0"))) > ZERO:
            signature_rarity_positive += 1

    return {
        "voucher_count": len(features),
        "scored_voucher_count": scored_count,
        "finding_count": len(findings),
        "finding_voucher_count": len(finding_vouchers),
        "review_rate": format(review_rate, "f"),
        "finding_severity_counts": dict(sorted(finding_severity_counts.items())),
        "voucher_risk_level_counts": dict(
            sorted(voucher_risk_level_counts.items())
        ),
        "code_counts": dict(sorted(code_counts.items())),
        "rarity_positive_voucher_count": rarity_positive,
        "pair_rarity_positive_voucher_count": pair_rarity_positive,
        "combination_rarity_positive_voucher_count": combination_rarity_positive,
        "signature_rarity_positive_voucher_count": signature_rarity_positive,
        "baseline_count": len(context.baselines),
        "baseline_scopes": sorted(context.baselines.keys()),
        "frequency_enabled_baseline_count": enabled_count,
        "frequency_disabled_baseline_count": disabled_count,
        "frequency_enabled_for_all": bool(context.baselines)
        and disabled_count == 0,
        "frequency_enabled_for_any": enabled_count > 0,
    }


def analyze_anomalies(
    entries: object,
    contra_results: Optional[Mapping[str, object]] = None,
    config: Optional[AnomalyConfig] = None,
) -> AnomalyResult:
    """Analyze a population and return all scores plus thresholded findings."""

    config = config or DEFAULT_ANOMALY_CONFIG
    context = build_anomaly_context(
        entries,
        contra_results=contra_results,
        config=config,
    )
    scores = _score_features(context.features, context)

    features_by_key = {feature.voucher_key: feature for feature in context.features}
    findings = []
    for score in scores:
        feature = features_by_key[score.voucher_key]
        findings.extend(_findings_for(feature, score, config))
    findings.sort(
        key=lambda item: (-item.risk_score, item.voucher_key, item.code)
    )

    warnings = []
    enabled_baselines = sum(
        1
        for baseline in context.baselines.values()
        if baseline.frequency_enabled
    )
    disabled_baselines = len(context.baselines) - enabled_baselines
    if context.baselines:
        if disabled_baselines == len(context.baselines):
            warnings.append("frequency_disabled_all_baselines")
        elif disabled_baselines > 0:
            warnings.append("frequency_disabled_for_some_baselines")
    if any(
        baseline.frequency_enabled
        and baseline.signature_diversity > config.max_signature_diversity
        for baseline in context.baselines.values()
    ):
        warnings.append("high_signature_diversity_scaled")
    summary = _summary(
        context.features,
        scores,
        findings,
        context,
    )
    if (
        Decimal(summary["review_rate"])
        > config.high_review_rate_warning_threshold
    ):
        warnings.append("high_review_rate")

    return AnomalyResult(
        scores=scores,
        findings=tuple(findings),
        summary=summary,
        warnings=tuple(warnings),
    )


class AnomalyEngine:
    """Reusable engine; holds configuration only, no learned state."""

    def __init__(self, config: Optional[AnomalyConfig] = None) -> None:
        self.config = config or DEFAULT_ANOMALY_CONFIG

    def build_context(
        self,
        entries: object,
        contra_results: Optional[Mapping[str, object]] = None,
    ) -> AnomalyContext:
        return build_anomaly_context(
            entries,
            contra_results=contra_results,
            config=self.config,
        )

    def score(
        self,
        entries: object,
        context: Optional[AnomalyContext] = None,
        contra_results: Optional[Mapping[str, object]] = None,
    ) -> Tuple[VoucherAnomalyScore, ...]:
        return score_entries(
            entries,
            context=context,
            contra_results=contra_results,
            config=self.config,
        )

    def analyze(
        self,
        entries: object,
        contra_results: Optional[Mapping[str, object]] = None,
    ) -> AnomalyResult:
        return analyze_anomalies(
            entries,
            contra_results=contra_results,
            config=self.config,
        )
