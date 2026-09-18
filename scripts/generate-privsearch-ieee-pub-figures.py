"""
IEEE-publication-ready PrivSearch figures.

Targets IEEE Transactions double-column format:
  - Width  : 7.16 in (181.8 mm)
  - Font   : Times New Roman, 10 pt labels, 11 pt title
  - Lines  : 2 pt data, 1.2 pt axes
  - DPI    : 600 PNG + vector PDF
  - Style  : white background, minimal grid, bold axis labels
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

import matplotlib
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np

matplotlib.use("Agg")

ROOT = Path(__file__).resolve().parents[1]
PA = ROOT / "Results" / "paper_assets"
OUT = ROOT / "PrivSearch_IEEE_Publication_Figures"

# ── Colour palette (works in greyscale via value contrast) ──────────────────
C = {
    "blue":   "#1f4e79",
    "orange": "#c55a11",
    "teal":   "#1a5276",
    "green":  "#1e6b3c",
    "purple": "#5b2c82",
    "red":    "#922b21",
    "gold":   "#9a7d0a",
    "grey":   "#4d5656",
    "ltblue": "#aed6f1",
    "ltorange": "#f5cba7",
    "ltteal": "#a2d9ce",
    "ltred":  "#f1948a",
}

FAMILY_COLORS = {
    "and":      C["red"],
    "or_of_and": C["green"],
    "semantic": C["purple"],
    "range":    C["orange"],
    "single":   C["teal"],
    "or":       C["teal"],
    "fuzzy":    C["teal"],
}

W2 = 7.16   # double-column width (inches)
W1 = 3.45   # single-column width


def ieee_style() -> None:
    try:
        matplotlib.font_manager.findfont("Times New Roman", raise_if_missing=True)
        family = "Times New Roman"
    except Exception:
        family = "DejaVu Serif"

    plt.rcParams.update({
        "font.family":        family,
        "font.size":          10,
        "axes.titlesize":     11,
        "axes.titleweight":   "bold",
        "axes.labelsize":     10,
        "axes.labelweight":   "bold",
        "axes.edgecolor":     "#111111",
        "axes.linewidth":     1.1,
        "axes.grid":          True,
        "grid.alpha":         0.25,
        "grid.linestyle":     "--",
        "grid.linewidth":     0.5,
        "xtick.labelsize":    9,
        "ytick.labelsize":    9,
        "xtick.direction":    "out",
        "ytick.direction":    "out",
        "xtick.major.width":  1.0,
        "ytick.major.width":  1.0,
        "legend.fontsize":    9,
        "legend.frameon":     False,
        "legend.edgecolor":   "none",
        "figure.facecolor":   "white",
        "axes.facecolor":     "white",
        "savefig.facecolor":  "white",
        "savefig.dpi":        600,
        "savefig.bbox":       "tight",
        "savefig.pad_inches": 0.05,
        "lines.linewidth":    2.0,
        "lines.markersize":   7,
        "patch.linewidth":    0.6,
    })


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def save(fig: plt.Figure, stem: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT / f"{stem}.png")
    fig.savefig(OUT / f"{stem}.pdf")
    plt.close(fig)
    print(f"  saved {stem}")


def bar_labels(ax: plt.Axes, bars, fmt: str = "{:.1f}", offset_frac: float = 0.012,
               fontsize: int = 8, color: str = "#111111") -> None:
    ymax = ax.get_ylim()[1]
    for bar in bars:
        h = bar.get_height()
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            h + ymax * offset_frac,
            fmt.format(h),
            ha="center", va="bottom",
            fontsize=fontsize, color=color,
        )


def _family_color(qtype: str) -> str:
    for key, color in FAMILY_COLORS.items():
        if qtype.startswith(key):
            return color
    return C["grey"]


# ════════════════════════════════════════════════════════════════════════════
# Fig 1 — Authentication Overhead Percentage (vertical bar, sorted desc)
# ════════════════════════════════════════════════════════════════════════════
def fig1_auth_overhead_pct() -> None:
    import matplotlib.patches as mpatches

    rows = sorted(
        read_csv(PA / "privsearch_healthcare_phase_breakdown.csv"),
        key=lambda r: float(r["auth_share_pct"]),
        reverse=True,
    )

    _pretty = {
        "and_2":         "AND-2",
        "and_4":         "AND-4",
        "or_of_and":     "OR-of-AND",
        "semantic_v1":   "Semantic-v1",
        "range_month_1": "Range-Month-1",
        "range_month_3": "Range-Month-3",
        "range_year_2":  "Range-Year-2",
        "range_year_3":  "Range-Year-3",
        "single_keyword":"Single Keyword",
        "or_2":          "OR-2",
        "or_3":          "OR-3",
        "fuzzy_1":       "Fuzzy-1",
    }

    labels = [_pretty.get(r["query_type"], r["query_type"]) for r in rows]
    values = [float(r["auth_share_pct"]) for r in rows]
    colors = [_family_color(r["query_type"]) for r in rows]
    x = np.arange(len(labels))

    fig, ax = plt.subplots(figsize=(10.5, 6.5), constrained_layout=True)
    bars = ax.bar(x, values, color=colors, width=0.65, zorder=3,
                  edgecolor="white", linewidth=0.5)

    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=30, ha="right", fontsize=10.5)
    ax.set_ylabel("Authentication Share of Total Latency (%)",
                  fontweight="bold", fontsize=12)
    ax.set_ylim(0, 115)
    ax.set_yticks(np.arange(0, 101, 20))
    ax.yaxis.set_major_formatter(mticker.FormatStrFormatter("%.0f%%"))
    ax.grid(axis="y", alpha=0.30, linestyle="--", linewidth=0.6, zorder=0)

    # Annotations: % centred inside tall bars, above short bars
    for bar, val in zip(bars, values):
        xc = bar.get_x() + bar.get_width() / 2
        if val >= 28:
            ax.text(xc, val / 2, f"{val:.1f}%",
                    ha="center", va="center",
                    fontsize=9.5, color="white", fontweight="bold")
        else:
            ax.text(xc, val + 1.8, f"{val:.1f}%",
                    ha="center", va="bottom",
                    fontsize=9.5, color="#111111")

    # Title + subtitle
    ax.set_title("Authentication Overhead Percentage",
                 fontsize=13, fontweight="bold", loc="left", pad=28)
    ax.text(0.0, 1.010,
            "Authentication dominates the heavier verified query families",
            transform=ax.transAxes, fontsize=9, color="#555555", style="italic",
            va="bottom", ha="left")

    # Legend for query families
    family_legend = [
        ("Conjunctive (AND)",             C["red"]),
        ("OR-of-AND (DNF)",               C["green"]),
        ("Semantic",                       C["purple"]),
        ("Temporal Range",                C["orange"]),
        ("Disjunctive / Keyword / Fuzzy", C["teal"]),
    ]
    handles = [
        mpatches.Patch(facecolor=col, label=lbl,
                       edgecolor="#333333", linewidth=0.6)
        for lbl, col in family_legend
    ]
    ax.legend(
        handles=handles,
        title="Query Family",
        title_fontsize=10,
        fontsize=9.5,
        loc="upper right",
        frameon=True,
        framealpha=0.95,
        edgecolor="#bbbbbb",
    )

    save(fig, "fig1_auth_overhead_pct")


# ════════════════════════════════════════════════════════════════════════════
# Fig 2 — Per-Query-Family Resource Overhead (2×2)
# ════════════════════════════════════════════════════════════════════════════
def fig2_resource_overhead() -> None:
    data = read_json(PA / "privsearch_resource_overhead_results.json")
    by_type = {r["query_type"]: r for r in data["summary_by_query_type"]}
    selected = ["single_keyword", "and_2", "or_2", "or_of_and", "range_month_1", "semantic_v1"]
    xlabels  = ["single",       "AND-2", "OR-2", "OR-of-AND", "range",          "semantic"]

    # mean_cpu_ms is stored in µs (from Node.js process.cpuUsage() which returns
    # microseconds); divide by 1000 to convert to actual milliseconds
    cpu     = [by_type[k]["mean_cpu_ms"] / 1000.0 for k in selected]
    mem_mib = [abs(by_type[k]["mean_rss_delta_bytes"]) / (1024**2) for k in selected]
    proof   = [by_type[k]["mean_proof_size_bytes"] for k in selected]
    net_kib = [by_type[k]["mean_network_total_bytes"] / 1024 for k in selected]

    panels = [
        (cpu,     "CPU time (ms)",          C["blue"],   "CPU Time"),
        (mem_mib, "Memory RSS delta (MiB)", C["orange"], "Memory Delta"),
        (proof,   "Proof size (bytes)",     C["purple"], "Proof Size"),
        (net_kib, "Network traffic (KiB)",  C["teal"],   "Network Traffic"),
    ]

    fig, axes = plt.subplots(2, 2, figsize=(W2, 6.0), constrained_layout=True)
    for ax, (vals, ylabel, color, title) in zip(axes.ravel(), panels):
        bars = ax.bar(xlabels, vals, color=color, width=0.68, zorder=3)
        ax.set_ylabel(ylabel, fontweight="bold", fontsize=10)
        ax.set_title(title, fontsize=10, fontweight="bold")
        ax.tick_params(axis="x", rotation=30, labelsize=9)
        ax.tick_params(axis="y", labelsize=9)
        ymax = max(vals) if max(vals) > 0 else 1
        ax.set_ylim(0, ymax * 1.18)
        for bar, val in zip(bars, vals):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                val + ymax * 0.01,
                f"{val:.1f}" if val >= 1 else f"{val:.2f}",
                ha="center", va="bottom", fontsize=9,
            )
    save(fig, "fig2_resource_overhead")


# ════════════════════════════════════════════════════════════════════════════
# Fig 3 — Search vs Verification Latency (horizontal stacked bar)
# ════════════════════════════════════════════════════════════════════════════
def fig3_search_vs_verify() -> None:
    rows = sorted(
        read_csv(PA / "privsearch_healthcare_phase_breakdown.csv"),
        key=lambda r: float(r["mean_total_ms"]),
    )
    labels = [r["query_type"] for r in rows]
    search = np.array([float(r["mean_search_ms"]) for r in rows])
    verify = np.array([float(r["mean_verify_ms"]) for r in rows])
    y = np.arange(len(labels))

    fig, ax = plt.subplots(figsize=(W2, 5.5), constrained_layout=True)
    ax.barh(y, search, color=C["blue"],   label="Search",       height=0.65, zorder=3)
    ax.barh(y, verify, left=search,       color=C["orange"], label="Verification", height=0.65, zorder=3)
    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=9)
    ax.invert_yaxis()
    ax.set_xlabel("Mean latency (ms)", fontweight="bold")
    ax.set_title("Search vs Verification Latency — Healthcare Benchmark Families")
    ax.legend(loc="lower right", ncol=2, fontsize=9)
    totals = search + verify
    xmax = totals.max()
    for i, (s, v) in enumerate(zip(search, verify)):
        ax.text(s + v + xmax * 0.01, i, f"{s + v:.1f}",
                va="center", fontsize=8, color="#111111")
    save(fig, "fig3_search_vs_verify")


# ════════════════════════════════════════════════════════════════════════════
# Fig 4 — Authentication-Overhead Share (horizontal, colour-coded by family)
# ════════════════════════════════════════════════════════════════════════════
def fig4_auth_share_horizontal() -> None:
    import matplotlib.patches as mpatches

    rows = sorted(
        read_csv(PA / "privsearch_healthcare_phase_breakdown.csv"),
        key=lambda r: float(r["auth_share_pct"]),
        reverse=True,
    )

    # Human-readable y-axis labels for IEEE publication
    _pretty = {
        "and_2":         "AND-2",
        "and_4":         "AND-4",
        "or_of_and":     "OR-of-AND",
        "semantic_v1":   "Semantic-v1",
        "range_month_1": "Range-Month-1",
        "range_month_3": "Range-Month-3",
        "range_year_2":  "Range-Year-2",
        "range_year_3":  "Range-Year-3",
        "single_keyword":"Single Keyword",
        "or_2":          "OR-2",
        "or_3":          "OR-3",
        "fuzzy_1":       "Fuzzy-1",
    }

    labels = [_pretty.get(r["query_type"], r["query_type"]) for r in rows]
    auth   = [float(r["auth_share_pct"]) for r in rows]
    verify = [float(r["verify_share_pct"]) for r in rows]
    totals = [float(r["mean_total_ms"]) for r in rows]
    colors = [_family_color(r["query_type"]) for r in rows]
    y = np.arange(len(labels))

    # Larger canvas for readability; constrained_layout handles margins
    fig, ax = plt.subplots(figsize=(9.5, 8.0), constrained_layout=True)

    ax.barh(y, auth, color=colors, height=0.65, zorder=3,
            edgecolor="white", linewidth=0.5)
    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=11)
    ax.invert_yaxis()
    ax.set_xlabel("Authentication Share of Total Latency (%)",
                  fontweight="bold", fontsize=12)
    ax.set_xlim(0, 116)
    ax.set_xticks(np.arange(0, 101, 20))
    ax.xaxis.set_major_formatter(mticker.FormatStrFormatter("%.0f%%"))
    ax.grid(axis="x", alpha=0.30, linestyle="--", linewidth=0.6, zorder=0)

    # Per-bar annotations: % centred inside bar (if wide enough), else outside;
    # total latency printed at fixed right margin
    for i, (a, v, t) in enumerate(zip(auth, verify, totals)):
        if a >= 22:
            ax.text(a / 2, i, f"{a:.1f}%",
                    va="center", ha="center",
                    fontsize=9.5, color="white", fontweight="bold")
        else:
            ax.text(a + 1.2, i, f"{a:.1f}%",
                    va="center", ha="left",
                    fontsize=9.5, color="#111111")
        ax.text(102, i, f"total {t:.1f} ms",
                va="center", ha="left",
                fontsize=8.5, color="#555555", style="italic")

    # Dashed 100 % reference line
    ax.axvline(100, color="#888888", linewidth=1.0, linestyle="--",
               zorder=2, label="_nolegend_")

    # ── Legend: one patch per query family ───────────────────────────────────
    family_legend = [
        ("Conjunctive (AND)",              C["red"]),
        ("OR-of-AND (DNF)",                C["green"]),
        ("Semantic",                       C["purple"]),
        ("Temporal Range",                 C["orange"]),
        ("Disjunctive / Keyword / Fuzzy",  C["teal"]),
    ]
    handles = [
        mpatches.Patch(facecolor=col, label=lbl,
                       edgecolor="#333333", linewidth=0.6)
        for lbl, col in family_legend
    ]
    ax.legend(
        handles=handles,
        title="Query Family",
        title_fontsize=10,
        fontsize=9.5,
        loc="lower right",
        frameon=True,
        framealpha=0.95,
        edgecolor="#bbbbbb",
    )

    # Title + subtitle
    ax.set_title(
        "Authentication-Overhead Share Across Healthcare Query Families",
        fontsize=13, fontweight="bold", loc="left", pad=28,
    )
    ax.text(
        0.0, 1.012,
        "Conjunctive, temporal-range, OR-of-AND, and semantic families"
        " are verification-dominant",
        transform=ax.transAxes,
        fontsize=9, color="#555555", style="italic",
        va="bottom", ha="left",
    )

    save(fig, "fig4_auth_share_horizontal")


# ════════════════════════════════════════════════════════════════════════════
# Fig 5 — Scalability vs Posting-List Size
# ════════════════════════════════════════════════════════════════════════════
def fig5_scalability_posting() -> None:
    data = read_json(PA / "privsearch_scalability_summary.json")
    rows = data["posting_list_rows"]
    x = [float(r["mean_doc_freq"]) for r in rows]
    y = [float(r["total_stats"]["mean"]) for r in rows]

    fig, ax = plt.subplots(figsize=(W2, 4.2), constrained_layout=True)
    ax.plot(x, y, marker="o", color=C["purple"], linewidth=2.2, markersize=7, zorder=3)
    ax.fill_between(x, y, alpha=0.18, color=C["purple"], zorder=2)
    ax.set_xscale("log")
    ax.set_xlabel("Mean posting frequency (documents)", fontweight="bold")
    ax.set_ylabel("Mean latency (ms)", fontweight="bold")
    ax.set_title("Scalability vs Posting List Size")
    ax.xaxis.set_major_formatter(mticker.LogFormatter(labelOnlyBase=False))
    save(fig, "fig5_scalability_posting_list")


# ════════════════════════════════════════════════════════════════════════════
# Fig 6 — Scalability vs Clause Count (AND / OR / DNF)
# ════════════════════════════════════════════════════════════════════════════
def fig6_scalability_clauses() -> None:
    rows = read_csv(PA / "privsearch_scalability_clause_count.csv")
    mode_map: dict[str, list[tuple[int, float]]] = {}
    for r in rows:
        if r["mode"] not in {"conjunctive", "disjunctive", "dnf"}:
            continue
        mode_map.setdefault(r["mode"], []).append(
            (int(r["clause_count"]), float(r["mean_total_ms"]))
        )

    styles = {
        "conjunctive": (C["blue"],   "o", "AND"),
        "disjunctive": (C["orange"], "s", "OR"),
        "dnf":         (C["green"],  "^", "DNF"),
    }

    fig, ax = plt.subplots(figsize=(W2, 4.2), constrained_layout=True)
    for mode, pts in mode_map.items():
        pts = sorted(pts)
        xs, ys = zip(*pts)
        color, marker, label = styles[mode]
        ax.plot(xs, ys, marker=marker, color=color, linewidth=2.2,
                markersize=7, label=label, zorder=3)
    ax.set_xlabel("Number of clauses", fontweight="bold")
    ax.set_ylabel("Mean latency (ms)", fontweight="bold")
    ax.set_title("Scalability vs Clause Count")
    ax.legend(ncol=3, loc="upper left")
    ax.xaxis.set_major_locator(mticker.MaxNLocator(integer=True))
    save(fig, "fig6_scalability_clause_count")


# ════════════════════════════════════════════════════════════════════════════
# Fig 7 — Concurrent Users (dual y-axis)
# ════════════════════════════════════════════════════════════════════════════
def fig7_concurrent_users() -> None:
    # Filter to and_2 (representative authenticated conjunctive query).
    # The CSV includes multiple query types; averaging all inflates throughput
    # to ~483–503 req/s because range queries are ~700 req/s.  The manuscript
    # reports 379–400 req/s which matches and_2 alone.
    rows = [r for r in read_csv(PA / "privsearch_scalability_concurrency.csv")
            if r["query_type"] == "and_2"]
    agg: dict[int, dict[str, list[float]]] = {}
    for r in rows:
        c = int(r["concurrency"])
        agg.setdefault(c, {"lat": [], "tput": []})
        agg[c]["lat"].append(float(r["mean_total_ms"]))
        agg[c]["tput"].append(float(r["throughput_rps"]))

    xs = sorted(agg)
    lat  = [np.mean(agg[c]["lat"])  for c in xs]
    tput = [np.mean(agg[c]["tput"]) for c in xs]

    fig, ax1 = plt.subplots(figsize=(W2, 4.2), constrained_layout=True)
    ax2 = ax1.twinx()
    l1, = ax1.plot(xs, lat,  color=C["blue"],   marker="o", linewidth=2.2,
                   markersize=7, label="Latency", zorder=3)
    l2, = ax2.plot(xs, tput, color=C["orange"], marker="s", linewidth=2.2,
                   markersize=7, label="Throughput", zorder=3)
    ax1.set_xlabel("Concurrent users", fontweight="bold", fontsize=10)
    ax1.set_ylabel("Mean latency (ms)", fontweight="bold", color=C["blue"], fontsize=10)
    ax2.set_ylabel("Throughput (req/s)", fontweight="bold", color=C["orange"], fontsize=10)
    ax1.tick_params(axis="y", labelcolor=C["blue"], labelsize=9)
    ax2.tick_params(axis="y", labelcolor=C["orange"], labelsize=9)
    ax1.tick_params(axis="x", labelsize=9)
    ax1.set_title("Concurrent Users (AND-2)", fontsize=11, fontweight="bold")
    ax1.legend(handles=[l1, l2], loc="center right", fontsize=9)
    save(fig, "fig7_concurrent_users")


# ════════════════════════════════════════════════════════════════════════════
# Fig 8 — Cryptographic Overhead Breakdown + Phase Composition
# ════════════════════════════════════════════════════════════════════════════
def fig8_crypto_breakdown() -> None:
    all_rows = {r["query_type"]: r
                for r in read_csv(PA / "privsearch_crypto_overhead_results.csv")}

    selected = ["and_2", "fuzzy_1", "or_2", "or_of_and", "range_month_1", "single_keyword"]
    xlabels  = ["AND-2", "Fuzzy-1", "OR-2", "OR-of-AND", "Range-Month-1", "Single Keyword"]
    rows    = [all_rows[k] for k in selected if k in all_rows]
    xlabels = [xlabels[i] for i, k in enumerate(selected) if k in all_rows]

    trapdoor   = np.array([float(r["mean_trapdoor_generation_ms"])          for r in rows])
    retrieval  = np.array([float(r["mean_encrypted_postings_retrieval_ms"]) for r in rows])
    proof_cons = np.array([float(r["mean_proof_construction_ms"])           for r in rows])
    proof_ver  = np.array([float(r["mean_proof_verification_ms"])           for r in rows])
    blockchain = np.array([float(r["mean_blockchain_verification_ms"])      for r in rows])
    totals     = trapdoor + retrieval + proof_cons + proof_ver + blockchain

    def safe_pct(arr):
        return np.where(totals > 0, arr / totals * 100, 0.0)

    td_pct  = safe_pct(trapdoor)
    ret_pct = safe_pct(retrieval)
    pc_pct  = safe_pct(proof_cons)
    pv_pct  = safe_pct(proof_ver)
    bc_pct  = safe_pct(blockchain)

    x = np.arange(len(rows))
    w = 0.62

    stack_colors = [C["blue"], C["teal"], C["gold"], C["orange"], C["purple"]]
    stack_labels = ["Trapdoor", "Retrieval", "Proof Construction",
                    "Proof Verification", "Blockchain Verification"]
    stacks_abs = [trapdoor, retrieval, proof_cons, proof_ver, blockchain]
    stacks_pct = [td_pct,  ret_pct,  pc_pct,     pv_pct,   bc_pct]

    fig, (ax0, ax1) = plt.subplots(
        1, 2, figsize=(13.0, 6.5),
        constrained_layout=True,
        gridspec_kw={"width_ratios": [1.15, 1.0]},
    )

    # Track cumulative bottoms so we can annotate segment midpoints accurately
    bottom_abs = np.zeros(len(rows))
    bottom_pct = np.zeros(len(rows))
    seg_bottoms_pct = []  # store per-phase bottom before accumulation

    for vals_a, vals_p, color, lab in zip(stacks_abs, stacks_pct, stack_colors, stack_labels):
        seg_bottoms_pct.append(bottom_pct.copy())
        ax0.bar(x, vals_a, bottom=bottom_abs, color=color, width=w,
                edgecolor="white", linewidth=0.8, label=lab, zorder=3)
        ax1.bar(x, vals_p, bottom=bottom_pct, color=color, width=w,
                edgecolor="white", linewidth=0.8, zorder=3)
        bottom_abs += vals_a
        bottom_pct += vals_p

    for ax in (ax0, ax1):
        ax.set_xticks(x)
        ax.set_xticklabels(xlabels, rotation=28, ha="right", fontsize=10.5)
        ax.grid(axis="y", alpha=0.30, linestyle="--", linewidth=0.6, zorder=0)

    # ── Left panel: absolute latency ─────────────────────────────────────────
    ax0.set_ylabel("Mean Latency (ms)", fontweight="bold", fontsize=12)
    ax0.set_title("Cryptographic Overhead Breakdown",
                  fontsize=13, fontweight="bold", loc="left", pad=28)
    ax0.text(0.0, 1.010, "Absolute phase latency per query family",
             transform=ax0.transAxes, fontsize=9, color="#555555", style="italic",
             va="bottom", ha="left")
    ymax0 = totals.max()
    ax0.set_ylim(0, ymax0 * 1.16)
    for i, t in enumerate(totals):
        ax0.text(i, t + ymax0 * 0.018, f"{t:.1f}",
                 ha="center", va="bottom", fontsize=10, color="#111111",
                 fontweight="bold")

    # ── Right panel: normalized % ─────────────────────────────────────────────
    ax1.set_ylim(0, 100)
    ax1.yaxis.set_major_formatter(mticker.FormatStrFormatter("%.0f%%"))
    ax1.set_ylabel("Share of Total Cryptographic Cost (%)", fontweight="bold", fontsize=12)
    ax1.set_title("Phase Composition",
                  fontsize=13, fontweight="bold", loc="left", pad=28)
    ax1.text(0.0, 1.010, "Normalized contribution — minor phases remain visible",
             transform=ax1.transAxes, fontsize=9, color="#555555", style="italic",
             va="bottom", ha="left")

    # Annotate the proof-verification segment midpoint (index 3 in stacks)
    pv_phase_idx = 3
    pv_bot = seg_bottoms_pct[pv_phase_idx]
    for i, pv in enumerate(pv_pct):
        if pv > 25:
            mid_y = pv_bot[i] + pv / 2
            ax1.text(i, mid_y, f"{pv:.1f}%",
                     ha="center", va="center", fontsize=9.5,
                     color="white", fontweight="bold")

    # ── Shared legend below both panels ──────────────────────────────────────
    handles, leg_labels = ax0.get_legend_handles_labels()
    fig.legend(
        handles, leg_labels,
        loc="lower center",
        bbox_to_anchor=(0.5, -0.04),
        ncol=5,
        fontsize=10,
        frameon=True,
        framealpha=0.95,
        edgecolor="#bbbbbb",
        title="Cryptographic Phase",
        title_fontsize=10,
    )

    save(fig, "fig8_crypto_breakdown")


# ════════════════════════════════════════════════════════════════════════════
def main() -> None:
    ieee_style()
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Generating IEEE-publication figures -> {OUT}")
    fig1_auth_overhead_pct()
    fig2_resource_overhead()
    fig3_search_vs_verify()
    fig4_auth_share_horizontal()
    fig5_scalability_posting()
    fig6_scalability_clauses()
    fig7_concurrent_users()
    fig8_crypto_breakdown()
    print(f"\nDone — {len(list(OUT.glob('*.png')))} PNG + PDF pairs in:\n  {OUT}")


if __name__ == "__main__":
    main()
