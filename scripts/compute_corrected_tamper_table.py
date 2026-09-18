"""
Compute corrected tamper-detection theory column for Table IX.

Because the hypergeometric detection probability is nonlinear in the
result-set size, evaluating it only at the mean result size need not equal
the mean of the workload-specific probabilities.

Methodology
-----------
The tamper benchmark (scripts/benchmark-tamper-injection.js) loads exactly
the seven query types:
    and_2, and_4, and_6, and_8, and_10, single_keyword, or_2
from the Enron inverted index.  Workloads are bucketed by expected_result_count
(small 1–49, medium 50–499, large 500–∞).  For each (t, s, bucket) cell the
eligible pool is filtered to R > t (substitution requires at least t docs),
then cycled in round-robin for 100 trials.

The corrected theoretical rate is:
    p_bar_det = (1/P) * sum_i p_det(n_i, t, s)
where the sum runs over the P eligible workloads in the cell (each n_i is
their expected_result_count).  Because cycling is uniform, every workload
contributes with equal frequency.

The original JSON uses the bucket-mean R̄ for the theory column, which
coincidentally exceeds s for several small-bucket cells (making it appear as
if s > n for ALL trials, i.e. theory = 100 %), whereas p_bar_det correctly
captures workloads whose n_i >= s.

Wilson 95 % CIs are computed from exact detection counts, recovered by
checking that rate * trials is an integer.
"""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PA   = ROOT / "Results" / "paper_assets"

ENRON_QR = (ROOT / "NweDB" / "benchmark_runs" /
            "enron_privsearch-prototype_2026-09-10T18-17-51-125Z" /
            "benchmark_query_results.csv")

# Exactly the query types loaded by benchmark-tamper-injection.js (line 78-79).
TAMPER_QUERY_TYPES = {
    "and_2", "and_4", "and_6", "and_8", "and_10",
    "single_keyword", "or_2",
}

# Bucket boundaries from BUCKET_DEFS in the JS script (lines 31-35).
# large.max = Infinity — no upper cap.
BUCKET_BOUNDS = {
    "small":  (1,   49),
    "medium": (50,  499),
    "large":  (500, math.inf),
}

T_VALUES = [1, 2, 5, 10]
S_VALUES = [5, 10, 25, 50]
TRIALS   = 100
Z95      = 1.959964   # z_{0.025}

# Expected total workloads loaded by the tamper benchmark (from run log).
EXPECTED_POOL_SIZE = 310


# ── Probability ───────────────────────────────────────────────────────────────

def p_det(n: int, t: int, s: int) -> float:
    """Detection probability for t substitutions in an n-result answer.

    Uniform sampling without replacement of min(s, n) docs.
    Uses log-space evaluation to avoid large binomial coefficients.
    """
    if n < 1:
        raise ValueError(f"n must be >= 1; got {n}")
    if not (1 <= t <= n):
        raise ValueError(f"Require 1 <= t <= n; got n={n}, t={t}")
    if s < 1:
        return 0.0

    s_eff = min(s, n)

    # If sample covers all non-tampered slots, at least one fake must appear.
    if s_eff > n - t:
        return 1.0

    # log P(miss) = sum_{j=0}^{s_eff-1} log(1 - t/(n-j))
    log_miss = sum(math.log1p(-t / (n - j)) for j in range(s_eff))
    return -math.expm1(log_miss)  # 1 - exp(log_miss), accurate near zero


# ── Confidence interval ────────────────────────────────────────────────────────

def wilson_ci(k: int, n: int, z: float = Z95) -> tuple[float, float]:
    """Wilson score 95 % CI for k successes in n Bernoulli trials."""
    p = k / n
    z2 = z * z
    denom = 1.0 + z2 / n
    center = (p + z2 / (2 * n)) / denom
    hw = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom
    return max(0.0, center - hw), min(1.0, center + hw)


# ── Load Enron workload pool ───────────────────────────────────────────────────

# Read result sizes for the exact query types used by the tamper benchmark.
all_sizes: list[int] = []
with open(ENRON_QR, newline="") as fh:
    for row in csv.DictReader(fh):
        if row["query_type"] not in TAMPER_QUERY_TYPES:
            continue
        n = int(row["expected_result_count"])
        if n >= 1:
            all_sizes.append(n)

# Bucket without any artificial upper cap (large = 500–∞, matching the JS).
buckets: dict[str, list[int]] = {
    "small":  [n for n in all_sizes if  1 <= n <=  49],
    "medium": [n for n in all_sizes if 50 <= n <= 499],
    "large":  [n for n in all_sizes if n >= 500],
}

print("Reconstructed tamper workload pool (7 Enron query types, R >= 1):")
for b, ns in buckets.items():
    lo, hi = BUCKET_BOUNDS[b]
    print(f"  {b:7s} ({lo:3}–{str(hi):>4}): {len(ns):3d} workloads, "
          f"mean={sum(ns)/len(ns):.0f}, min={min(ns)}, max={max(ns)}")

pool_size = sum(len(ns) for ns in buckets.values())
print(f"\n  Total: {pool_size} workloads (expected {EXPECTED_POOL_SIZE})")

if pool_size != EXPECTED_POOL_SIZE:
    raise RuntimeError(
        f"\nPool validation failed: expected {EXPECTED_POOL_SIZE} workloads "
        f"but bucket filters selected {pool_size}.\n"
        "The Enron benchmark CSV does not reproduce the exact tamper pool — "
        "either the query-workload file used by the tamper benchmark differs "
        "from the benchmark run, or some workloads were re-generated between "
        "runs.  To recover exact trial-level n_i values, add per-trial logging "
        "to benchmark-tamper-injection.js and rerun the tamper experiment."
    )

# ── Load empirical results ─────────────────────────────────────────────────────

with open(PA / "tamper_injection.json") as fh:
    tamper = json.load(fh)

empirical_by_key: dict[tuple[int, int, str], dict] = {}
for rec in tamper["results"]:
    key = (int(rec["t"]), int(rec["s"]), rec["bucket"])
    if key in empirical_by_key:
        raise RuntimeError(f"Duplicate cell in tamper_injection.json: {key}")

    n_trials = int(rec.get("trials", TRIALS))
    raw_count = float(rec["empirical_detect_rate"]) * n_trials
    detections = round(raw_count)
    if not math.isclose(raw_count, detections, abs_tol=1e-6):
        raise RuntimeError(
            f"Cannot recover exact detection count for {key}: "
            f"rate={rec['empirical_detect_rate']}, trials={n_trials}, "
            f"product={raw_count:.6f}"
        )
    if not (0 <= detections <= n_trials):
        raise RuntimeError(f"Invalid detection counts for {key}")

    empirical_by_key[key] = {
        "detections": detections,
        "trials": n_trials,
        "rate": detections / n_trials,
    }

# ── Compute corrected theory ───────────────────────────────────────────────────

rows_out: list[dict] = []

for t in T_VALUES:
    for s in S_VALUES:
        for bucket in ("small", "medium", "large"):
            base_ns = buckets[bucket]

            # Mirror the JS eligibility filter: pool = buckets[bd.label].filter(p => p.R > t)
            # Workloads with R == t cannot have t docs substituted.
            eligible_ns = [n for n in base_ns if n > t]
            excluded    = [n for n in base_ns if n <= t]

            if excluded:
                # This is expected for small t — workloads with n <= t are
                # genuinely ineligible (substitution is impossible).
                # We do NOT silently drop them; we verify the empirical
                # benchmark used the same filter.
                pass  # eligible_ns is the correct population

            if not eligible_ns:
                print(f"  t={t} s={s} {bucket}: no eligible workloads (all n <= t) — skip")
                continue

            # Theoretical p_bar: mean over eligible pool (each workload
            # visited with equal frequency in round-robin cycling).
            probabilities = [p_det(n, t, s) for n in eligible_ns]
            pbar = sum(probabilities) / len(probabilities)

            # Empirical
            emp_rec = empirical_by_key[(t, s, bucket)]
            k       = emp_rec["detections"]
            n_tri   = emp_rec["trials"]
            emp     = emp_rec["rate"]
            lo, hi  = wilson_ci(k, n_tri)

            # Old theory (evaluated at bucket mean of the ELIGIBLE pool,
            # matching what the JS did: mean(pool.map(p => p.R))).
            mean_n_eligible = sum(eligible_ns) / len(eligible_ns)
            old_theory = p_det(round(mean_n_eligible), t, s)

            rows_out.append({
                "t": t, "s": s, "bucket": bucket,
                "R_mean_eligible": mean_n_eligible,
                "N_eligible":     len(eligible_ns),
                "N_excluded":     len(excluded),
                "trials":         n_tri,
                "detections":     k,
                "old_theory_pct": old_theory * 100,
                "new_theory_pct": pbar * 100,
                "empirical_pct":  emp * 100,
                "ci_lo_pct":      lo * 100,
                "ci_hi_pct":      hi * 100,
            })

# ── Print ─────────────────────────────────────────────────────────────────────

print(f"\n{'t':>3} {'s':>3} {'bucket':>8} {'R_elig':>7} {'N_elig':>6}"
      f"  {'old(%)':>8}  {'new(%)':>8}  {'emp(%)':>8}  95% CI")
print("-" * 82)
for r in rows_out:
    print(f"{r['t']:>3} {r['s']:>3} {r['bucket']:>8}"
          f" {r['R_mean_eligible']:>7.1f} {r['N_eligible']:>6}"
          f"  {r['old_theory_pct']:>8.2f}  {r['new_theory_pct']:>8.2f}"
          f"  {r['empirical_pct']:>8.2f}"
          f"  [{r['ci_lo_pct']:5.1f}, {r['ci_hi_pct']:5.1f}]")

# ── LaTeX fragment ────────────────────────────────────────────────────────────

print("\n\n% === LaTeX rows for Table IX ===")
BUCKET_LABELS = {
    "small":  r"Small ($1$--$49$)",
    "medium": r"Medium ($50$--$499$)",
    "large":  r"Large (${\geq}500$)",
}
for r in rows_out:
    lbl    = BUCKET_LABELS[r["bucket"]]
    ci_str = rf"[{r['ci_lo_pct']:.0f},\,{r['ci_hi_pct']:.0f}]"
    new_s  = f"{r['new_theory_pct']:.1f}\\%"
    print(f"  % t={r['t']}, s={r['s']}, {r['bucket']}  "
          f"(N={r['N_eligible']} eligible)")
    print(f"  {r['t']} & {r['s']} & {lbl} & "
          f"{r['R_mean_eligible']:.0f} & "
          f"{r['empirical_pct']:.0f}\\% {ci_str} & "
          f"{new_s} \\\\")

# ── MAE ───────────────────────────────────────────────────────────────────────

mae_old = sum(abs(r["empirical_pct"] - r["old_theory_pct"]) for r in rows_out) / len(rows_out)
mae_new = sum(abs(r["empirical_pct"] - r["new_theory_pct"]) for r in rows_out) / len(rows_out)
print(f"\nMAE (old theory vs empirical): {mae_old:.2f} pp  "
      f"(over {len(rows_out)} cells)")
print(f"MAE (new p_bar_det vs empirical): {mae_new:.2f} pp")

# ── Save ─────────────────────────────────────────────────────────────────────

out_path = PA / "tamper_corrected_theory.json"
with open(out_path, "w") as fh:
    json.dump(rows_out, fh, indent=2)
print(f"\nSaved to {out_path}")
