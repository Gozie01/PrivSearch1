from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
PAPER_ASSETS = ROOT / "Results" / "paper_assets"
BENCHMARK_RUNS = ROOT / "NweDB" / "benchmark_runs"
OUTPUT_DIR = ROOT / "PrivSearch_Requested_Experiment_Figures"


PALETTE = {
    "blue": "#2563eb",
    "blue_light": "#93c5fd",
    "teal": "#0f766e",
    "teal_light": "#5eead4",
    "orange": "#ea580c",
    "orange_light": "#fdba74",
    "green": "#16a34a",
    "green_light": "#86efac",
    "red": "#dc2626",
    "red_light": "#fca5a5",
    "purple": "#7c3aed",
    "purple_light": "#c4b5fd",
    "gold": "#ca8a04",
    "slate": "#334155",
    "slate_mid": "#475569",
    "slate_light": "#cbd5e1",
}


DATASET_SCOPE_CSV = PAPER_ASSETS / "table_privsearch_healthcare_dataset_scope.csv"
HEALTHCARE_PHASE_CSV = PAPER_ASSETS / "privsearch_healthcare_phase_breakdown.csv"
RESOURCE_JSON = PAPER_ASSETS / "privsearch_resource_overhead_results.json"
REPLAY_JSON = PAPER_ASSETS / "privsearch_replay_protection.json"
WAN_CSV = PAPER_ASSETS / "distributed_validation_wan.csv"


def configure_style() -> None:
    plt.rcParams.update(
        {
            "font.family": "DejaVu Sans",
            "font.size": 10.5,
            "axes.titlesize": 12.5,
            "axes.labelsize": 11,
            "axes.edgecolor": PALETTE["slate"],
            "axes.linewidth": 0.9,
            "axes.grid": True,
            "grid.alpha": 0.22,
            "grid.linestyle": "--",
            "grid.linewidth": 0.6,
            "legend.fontsize": 9.2,
            "xtick.labelsize": 9.5,
            "ytick.labelsize": 9.5,
            "figure.facecolor": "white",
            "axes.facecolor": "white",
            "savefig.facecolor": "white",
            "savefig.bbox": "tight",
        }
    )


def ensure_output_dir() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_figure(fig: plt.Figure, stem: str) -> None:
    fig.savefig(OUTPUT_DIR / f"{stem}.png", dpi=400)
    fig.savefig(OUTPUT_DIR / f"{stem}.svg")
    plt.close(fig)


def add_title(ax: plt.Axes, title: str, subtitle: str | None = None) -> None:
    ax.set_title("")
    ax.text(
        0.0,
        1.12,
        title,
        transform=ax.transAxes,
        ha="left",
        va="bottom",
        fontsize=15,
        fontweight="bold",
        color=PALETTE["slate"],
    )
    if subtitle:
        ax.text(
            0.0,
            1.055,
            subtitle,
            transform=ax.transAxes,
            ha="left",
            va="bottom",
            fontsize=9,
            color=PALETTE["slate_mid"],
        )


def latest_seacq_comparison_csv() -> Path:
    candidates = sorted(
        [path for path in BENCHMARK_RUNS.iterdir() if path.is_dir() and path.name.startswith("seacq_comparison_")],
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(f"No SeaCQ comparison run found in {BENCHMARK_RUNS}")
    csv_path = candidates[0] / "seacq_comparison_table.csv"
    if not csv_path.exists():
        raise FileNotFoundError(f"Expected comparison table not found: {csv_path}")
    return csv_path


def figure_01_healthcare_source_composition() -> None:
    rows = read_csv(DATASET_SCOPE_CSV)
    labels = [row["dataset"] for row in rows]
    values = [int(row["record_count"]) for row in rows]
    total = sum(values)
    shares = [value / total * 100 for value in values]

    fig, axes = plt.subplots(1, 2, figsize=(12.8, 5.2), constrained_layout=True)

    colors = [PALETTE["blue"], PALETTE["orange"], PALETTE["green"]]
    bars = axes[0].bar(labels, values, color=colors, width=0.62)
    add_title(axes[0], "Healthcare-Corpus Source Composition", "Absolute record counts across the merged validation corpus")
    axes[0].set_ylabel("Records")
    axes[0].yaxis.set_major_formatter(lambda value, _: f"{int(value):,}")
    axes[0].tick_params(axis="x", rotation=12)
    for bar, value, share in zip(bars, values, shares):
        axes[0].text(
            bar.get_x() + bar.get_width() / 2,
            value,
            f"{value:,}\n({share:.1f}%)",
            ha="center",
            va="bottom",
            fontsize=8.6,
            color=PALETTE["slate"],
        )

    wedges, texts = axes[1].pie(
        values,
        labels=None,
        colors=colors,
        startangle=90,
        wedgeprops=dict(width=0.45, edgecolor="white", linewidth=1.0),
    )
    add_title(axes[1], "Relative Share", "openFDA and eICU dominate the heterogeneous healthcare benchmark")
    for wedge, label, share in zip(wedges, labels, shares):
        angle = (wedge.theta2 + wedge.theta1) / 2.0
        x = np.cos(np.deg2rad(angle))
        y = np.sin(np.deg2rad(angle))
        axes[1].annotate(
            f"{label}\n{share:.1f}%",
            xy=(0.78 * x, 0.78 * y),
            xytext=(1.18 * x, 1.18 * y),
            ha="left" if x >= 0 else "right",
            va="center",
            fontsize=8.8,
            arrowprops=dict(arrowstyle="-", color=PALETTE["slate_mid"], lw=0.9),
        )

    save_figure(fig, "figure_01_healthcare_corpus_source_composition")


def figure_02_authentication_overhead_share() -> None:
    rows = read_csv(HEALTHCARE_PHASE_CSV)
    rows = sorted(rows, key=lambda row: float(row["auth_share_pct"]), reverse=True)
    labels = [row["query_type"] for row in rows]
    auth_share = [float(row["auth_share_pct"]) for row in rows]
    verify_share = [float(row["verify_share_pct"]) for row in rows]
    totals = [float(row["mean_total_ms"]) for row in rows]
    y = np.arange(len(labels))

    fig, ax = plt.subplots(figsize=(12.8, 6.8), constrained_layout=True)
    colors = []
    for label in labels:
        if label.startswith("and_"):
            colors.append(PALETTE["red"])
        elif label.startswith("range_"):
            colors.append(PALETTE["orange"])
        elif label.startswith("semantic"):
            colors.append(PALETTE["purple"])
        else:
            colors.append(PALETTE["teal"])

    bars = ax.barh(y, auth_share, color=colors, height=0.68)
    ax.set_yticks(y)
    ax.set_yticklabels(labels)
    ax.invert_yaxis()
    ax.set_xlim(0, 105)
    ax.set_xlabel("Authentication share of total latency (%)")
    add_title(
        ax,
        "Authentication-Overhead Share Across Healthcare Query Families",
        "Conjunctive, temporal-range, OR-of-AND, and semantic families are verification-dominant",
    )
    for i, (bar, share, verify, total) in enumerate(zip(bars, auth_share, verify_share, totals)):
        ax.text(
            min(share + 1.2, 103.5),
            i,
            f"{share:.1f}%  |  verify {verify:.1f}%  |  total {total:.1f} ms",
            va="center",
            ha="left",
            fontsize=8.3,
            color=PALETTE["slate"],
        )

    save_figure(fig, "figure_02_authentication_overhead_share")


def figure_03_seacq_overlay() -> None:
    rows = read_csv(latest_seacq_comparison_csv())
    rows = sorted(rows, key=lambda row: int(row["query_type"].split("_")[1]))
    x = [int(row["query_type"].split("_")[1]) for row in rows]
    priv_search = [float(row["privsearch_mean_search_ms"]) for row in rows]
    seacq_search = [float(row["seacq_published_search_ms"]) for row in rows]
    priv_verify = [float(row["privsearch_mean_verify_ms"]) for row in rows]
    seacq_verify = [float(row["seacq_published_verify_ms"]) for row in rows]
    search_speedup = [sea / priv for sea, priv in zip(seacq_search, priv_search)]
    verify_speedup = [sea / priv for sea, priv in zip(seacq_verify, priv_verify)]

    fig, axes = plt.subplots(1, 2, figsize=(13.2, 5.2), constrained_layout=True)
    fig.suptitle(
        "SeaCQ-Aligned Conjunctive Comparison",
        fontsize=18,
        fontweight="bold",
        color=PALETTE["slate"],
        y=1.02,
    )

    panels = [
        (
            axes[0],
            priv_search,
            seacq_search,
            search_speedup,
            "Search latency (ms)",
            "Search latency",
            "Log-scale overlay makes both curves readable despite large separation",
        ),
        (
            axes[1],
            priv_verify,
            seacq_verify,
            verify_speedup,
            "Verification latency (ms)",
            "Verification latency",
            "Published SeaCQ verification costs remain orders of magnitude above measured PrivSearch values",
        ),
    ]

    for ax, priv_values, seacq_values, speedups, ylabel, title, subtitle in panels:
        ax.plot(x, seacq_values, color=PALETTE["orange"], marker="^", linewidth=2.2, markersize=6, label="SeaCQ (published)")
        ax.plot(x, priv_values, color=PALETTE["teal"], marker="o", linewidth=2.2, markersize=6, label="PrivSearch (measured)")
        ax.set_xlabel("Number of conjunctive keywords, $k$")
        ax.set_ylabel(ylabel)
        ax.set_xticks(x)
        ax.set_yscale("log")
        add_title(ax, title, subtitle)
        ax.set_ylim(min(priv_values) * 0.7, max(seacq_values) * 1.5)
        for keyword_count, speedup in zip(x, speedups):
            y_mid = (priv_values[x.index(keyword_count)] * seacq_values[x.index(keyword_count)]) ** 0.5
            ax.text(
                keyword_count,
                y_mid,
                f"{speedup:.0f}x",
                ha="center",
                va="center",
                fontsize=8.1,
                color=PALETTE["slate_mid"],
                bbox=dict(boxstyle="round,pad=0.18", facecolor="white", edgecolor=PALETTE["slate_light"], alpha=0.92),
            )

    axes[0].legend(frameon=False, loc="upper right")
    axes[1].legend(frameon=False, loc="upper right")

    save_figure(fig, "figure_03_seacq_aligned_conjunctive_overlay")


def figure_04_resource_overhead() -> None:
    data = read_json(RESOURCE_JSON)
    summary = {row["query_type"]: row for row in data["summary_by_query_type"]}
    selected = [
        ("single_keyword", "single"),
        ("and_2", "AND-2"),
        ("or_2", "OR-2"),
        ("or_of_and", "OR-of-AND"),
        ("range_month_1", "range"),
        ("semantic_v1", "semantic"),
    ]
    labels = [label for _, label in selected]
    cpu = [summary[key]["mean_cpu_ms"] for key, _ in selected]
    rss_mib = [abs(summary[key]["mean_rss_delta_bytes"]) / (1024 * 1024) for key, _ in selected]
    proof = [summary[key]["mean_proof_size_bytes"] for key, _ in selected]
    network_kib = [summary[key]["mean_network_total_bytes"] / 1024 for key, _ in selected]

    fig, axes = plt.subplots(2, 2, figsize=(13.2, 8.0), constrained_layout=True)
    panels = [
        (axes[0, 0], cpu, "CPU time (ms)", PALETTE["blue"], "CPU"),
        (axes[0, 1], rss_mib, "Absolute RSS delta (MiB)", PALETTE["orange"], "Memory delta"),
        (axes[1, 0], proof, "Proof size (bytes)", PALETTE["purple"], "Proof bytes"),
        (axes[1, 1], network_kib, "Network traffic (KiB)", PALETTE["teal"], "Network bytes"),
    ]

    for ax, values, ylabel, color, title in panels:
        bars = ax.bar(labels, values, color=color, width=0.62)
        ax.set_ylabel(ylabel)
        ax.tick_params(axis="x", rotation=18)
        add_title(ax, f"Per-Query-Family Resource Overhead: {title}")
        for bar, value in zip(bars, values):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                bar.get_height(),
                f"{value:.1f}",
                ha="center",
                va="bottom",
                fontsize=8.2,
                color=PALETTE["slate"],
            )

    save_figure(fig, "figure_04_per_query_family_resource_overhead")


def figure_05_replay_protection() -> None:
    data = read_json(REPLAY_JSON)
    results = data["results"]
    accepted = int(results["accepted"])
    rejected = int(results["rejected"])
    replay_stats = results["replayLatencyMs"]
    samples = results.get("replayLatencySamplesMs") or []

    fig, axes = plt.subplots(1, 2, figsize=(12.8, 5.0), constrained_layout=True)

    bars = axes[0].bar(
        ["Accepted first requests", "Rejected replayed requests"],
        [accepted, rejected],
        color=[PALETTE["green"], PALETTE["red"]],
        width=0.56,
    )
    add_title(axes[0], "Replay-Protection Outcomes", "The measured benchmark accepted fresh writes and rejected replay attempts")
    axes[0].set_ylabel("Requests")
    for bar, value in zip(bars, [accepted, rejected]):
        axes[0].text(bar.get_x() + bar.get_width() / 2, value, f"{value}", ha="center", va="bottom", fontsize=9)

    if samples:
        axes[1].hist(samples, bins=18, color=PALETTE["orange"], edgecolor="white", linewidth=0.8)
        axes[1].axvline(np.mean(samples), color=PALETTE["blue"], linewidth=2, label=f"Mean {np.mean(samples):.3f} ms")
        axes[1].axvline(np.percentile(samples, 95), color=PALETTE["purple"], linewidth=2, linestyle="--", label=f"P95 {np.percentile(samples, 95):.3f} ms")
        axes[1].set_xlabel("Replay rejection latency (ms)")
        axes[1].set_ylabel("Frequency")
        add_title(axes[1], "Replay Rejection Latency Distribution", "Histogram from measured replay-latency samples")
        axes[1].legend(frameon=False, loc="upper right")
    else:
        x_pos = [0]
        axes[1].hlines(1, replay_stats["min"], replay_stats["max"], color=PALETTE["slate"], linewidth=2)
        axes[1].hlines(1, replay_stats["p50"], replay_stats["p95"], color=PALETTE["orange"], linewidth=7, alpha=0.75)
        axes[1].scatter([replay_stats["mean"]], [1], color=PALETTE["blue"], s=55, zorder=3, label=f"Mean {replay_stats['mean']:.3f} ms")
        axes[1].scatter([replay_stats["p50"]], [1], color=PALETTE["teal"], s=45, zorder=3, label=f"Median {replay_stats['p50']:.3f} ms")
        axes[1].scatter([replay_stats["p95"]], [1], color=PALETTE["purple"], s=45, zorder=3, label=f"P95 {replay_stats['p95']:.3f} ms")
        axes[1].set_yticks([])
        axes[1].set_xlabel("Replay rejection latency (ms)")
        axes[1].set_ylim(0.7, 1.3)
        add_title(axes[1], "Replay Rejection Latency Summary", "Measured min / median / mean / P95 / max from the persisted replay benchmark")
        axes[1].legend(frameon=False, loc="upper right")
        axes[1].text(replay_stats["min"], 1.05, f"min {replay_stats['min']:.3f}", fontsize=8, color=PALETTE["slate"])
        axes[1].text(replay_stats["max"], 1.05, f"max {replay_stats['max']:.3f}", fontsize=8, color=PALETTE["slate"], ha="right")

    save_figure(fig, "figure_05_replay_protection_benchmark")


def figure_06_wan_distributed_validation() -> None:
    rows = read_csv(WAN_CSV)
    profile_order = [
        ("LAN", PALETTE["blue"]),
        ("Regional WAN", PALETTE["orange"]),
        ("Cross-Site WAN", PALETTE["red"]),
    ]

    fig, axes = plt.subplots(1, 2, figsize=(13.0, 5.2), constrained_layout=True)
    panel_specs = [
        (axes[0], "end_to_end_threshold_mean_ms", "Threshold-path latency (ms)", "Threshold validation path"),
        (axes[1], "end_to_end_full_mean_ms", "Full-path latency (ms)", "Full validator-collection path"),
    ]

    for ax, key, ylabel, subtitle in panel_specs:
        for profile_label, color in profile_order:
            profile_rows = [row for row in rows if row["profile_label"] == profile_label]
            xs = [int(row["nodes"]) for row in profile_rows]
            ys = [float(row[key]) for row in profile_rows]
            ax.plot(xs, ys, marker="o", linewidth=2.2, markersize=6, color=color, label=profile_label)
        ax.set_xlabel("Validator nodes")
        ax.set_ylabel(ylabel)
        ax.set_xticks([2, 4, 7, 10])
        add_title(ax, "WAN-Style Distributed Validation Latency", subtitle)
        ax.legend(frameon=False, loc="upper left")

    save_figure(fig, "figure_06_wan_style_distributed_validation")


def write_manifest() -> None:
    lines = [
        "# PrivSearch Requested Experiment Figures",
        "",
        "Generated directly from the current local PrivSearch experiment artifacts.",
        "",
        "## Figures",
        "- figure_01_healthcare_corpus_source_composition",
        "- figure_02_authentication_overhead_share",
        "- figure_03_seacq_aligned_conjunctive_overlay",
        "- figure_04_per_query_family_resource_overhead",
        "- figure_05_replay_protection_benchmark",
        "- figure_06_wan_style_distributed_validation",
        "",
        "## Source Artifacts",
        "- Results/paper_assets/table_privsearch_healthcare_dataset_scope.csv",
        "- Results/paper_assets/privsearch_healthcare_phase_breakdown.csv",
        "- Results/paper_assets/privsearch_resource_overhead_results.json",
        "- Results/paper_assets/privsearch_replay_protection.json",
        "- Results/paper_assets/distributed_validation_wan.csv",
        "- NweDB/benchmark_runs/seacq_comparison_*/seacq_comparison_table.csv",
        "",
        "## Note",
        "- The replay panel uses a true histogram when persisted replay-latency samples are available.",
        "- If only summary statistics are present in the replay artifact, the figure falls back to a measured summary distribution panel using min, median, mean, P95, and max.",
    ]
    (OUTPUT_DIR / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    configure_style()
    ensure_output_dir()
    figure_01_healthcare_source_composition()
    figure_02_authentication_overhead_share()
    figure_03_seacq_overlay()
    figure_04_resource_overhead()
    figure_05_replay_protection()
    figure_06_wan_distributed_validation()
    write_manifest()
    print(OUTPUT_DIR)


if __name__ == "__main__":
    main()
