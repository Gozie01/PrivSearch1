from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import FancyBboxPatch


ROOT = Path(__file__).resolve().parents[1]
PAPER_ASSETS = ROOT / "Results" / "paper_assets"
OUTPUT_DIR = ROOT / "PrivSearch_IEEE_Transactions_Figures"

HEALTHCARE_PHASE_CSV = PAPER_ASSETS / "privsearch_healthcare_phase_breakdown.csv"
HEALTHCARE_SUMMARY_MD = PAPER_ASSETS / "privsearch_healthcare_validation_summary.md"
ABLATION_CSV = PAPER_ASSETS / "privsearch_ablation_results.csv"
SCALABILITY_JSON = PAPER_ASSETS / "privsearch_scalability_summary.json"
SCALABILITY_CLAUSE_CSV = PAPER_ASSETS / "privsearch_scalability_clause_count.csv"
SCALABILITY_CONCURRENCY_CSV = PAPER_ASSETS / "privsearch_scalability_concurrency.csv"
CRYPTO_CSV = PAPER_ASSETS / "privsearch_crypto_overhead_results.csv"
REPLAY_CSV = PAPER_ASSETS / "privsearch_replay_protection.csv"
DISTRIBUTED_WAN_CSV = PAPER_ASSETS / "distributed_validation_wan.csv"
RESOURCE_JSON = PAPER_ASSETS / "privsearch_resource_overhead_results.json"


PALETTE = {
    "teal": "#0f766e",
    "teal_light": "#5eead4",
    "blue": "#2563eb",
    "blue_light": "#93c5fd",
    "orange": "#ea580c",
    "orange_light": "#fdba74",
    "gold": "#ca8a04",
    "gold_light": "#fde68a",
    "red": "#dc2626",
    "red_light": "#fca5a5",
    "slate": "#334155",
    "slate_light": "#cbd5e1",
    "green": "#16a34a",
    "green_light": "#86efac",
    "purple": "#7c3aed",
    "purple_light": "#c4b5fd",
}


def configure_style() -> None:
    plt.rcParams.update(
        {
            "font.family": "DejaVu Sans",
            "font.size": 10.5,
            "axes.titlesize": 14,
            "axes.labelsize": 11,
            "axes.edgecolor": "#334155",
            "axes.linewidth": 0.9,
            "axes.grid": True,
            "grid.alpha": 0.22,
            "grid.linestyle": "--",
            "grid.linewidth": 0.6,
            "xtick.labelsize": 9.5,
            "ytick.labelsize": 9.5,
            "legend.fontsize": 9.2,
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
    png_path = OUTPUT_DIR / f"{stem}.png"
    svg_path = OUTPUT_DIR / f"{stem}.svg"
    fig.savefig(png_path, dpi=320)
    fig.savefig(svg_path)
    plt.close(fig)


def add_panel_title(ax: plt.Axes, title: str, subtitle: str | None = None) -> None:
    ax.set_title("")
    ax.text(
        0.0,
        1.14,
        title,
        transform=ax.transAxes,
        ha="left",
        va="bottom",
        fontsize=14,
        fontweight="bold",
        color=PALETTE["slate"],
    )
    if subtitle:
        ax.text(
            0.0,
            1.08,
            subtitle,
            transform=ax.transAxes,
            ha="left",
            va="bottom",
            fontsize=9.5,
            color="#475569",
        )


def parse_healthcare_scope() -> dict[str, int]:
    text = HEALTHCARE_SUMMARY_MD.read_text(encoding="utf-8")
    values = {}
    mapping = {
        "Normalized healthcare corpus": "healthcare_total",
        "eICU-derived records": "eicu",
        "MedCD search-note records": "medcd",
        "openFDA-derived records": "openfda",
    }
    for label, key in mapping.items():
        marker = f"- {label}: `"
        start = text.find(marker)
        if start == -1:
            continue
        start += len(marker)
        end = text.find("`", start)
        values[key] = int(text[start:end].replace(",", ""))

    values["enron_total"] = 517401
    return values


def figure_01_pipeline() -> None:
    fig, ax = plt.subplots(figsize=(12.5, 3.5), constrained_layout=True)
    ax.set_axis_off()
    steps = [
        "Datasets",
        "Index\nconstruction",
        "Workload\ngeneration",
        "Benchmark\nengine",
        "Analysis",
        "Plots",
    ]
    x_positions = np.linspace(0.07, 0.93, len(steps))
    width = 0.12
    height = 0.3
    colors = [
        PALETTE["blue_light"],
        PALETTE["teal_light"],
        PALETTE["gold_light"],
        PALETTE["orange_light"],
        PALETTE["purple_light"],
        PALETTE["green_light"],
    ]

    for i, (x, label) in enumerate(zip(x_positions, steps)):
        y = 0.5
        box = FancyBboxPatch(
            (x - width / 2, y - height / 2),
            width,
            height,
            boxstyle="round,pad=0.015,rounding_size=0.025",
            linewidth=1.2,
            edgecolor=PALETTE["slate"],
            facecolor=colors[i],
            transform=ax.transAxes,
        )
        ax.add_patch(box)
        ax.text(
            x,
            y,
            label,
            ha="center",
            va="center",
            fontsize=11.5,
            fontweight="bold",
            color=PALETTE["slate"],
            transform=ax.transAxes,
        )
        if i < len(steps) - 1:
            ax.annotate(
                "",
                xy=(x_positions[i + 1] - width / 2 - 0.01, y),
                xytext=(x + width / 2 + 0.01, y),
                xycoords=ax.transAxes,
                arrowprops=dict(arrowstyle="->", lw=1.8, color=PALETTE["slate"]),
            )

    ax.text(
        0.01,
        0.95,
        "Experimental Pipeline",
        transform=ax.transAxes,
        ha="left",
        va="top",
        fontsize=16,
        fontweight="bold",
        color=PALETTE["slate"],
    )
    ax.text(
        0.01,
        0.87,
        "From corpus preparation to final IEEE-style benchmark figures",
        transform=ax.transAxes,
        ha="left",
        va="top",
        fontsize=10,
        color="#475569",
    )
    save_figure(fig, "figure_01_experimental_pipeline")


def figure_02_dataset_composition() -> None:
    scope = parse_healthcare_scope()
    fig, axes = plt.subplots(1, 2, figsize=(12.5, 4.8), constrained_layout=True)

    datasets = ["Enron", "Healthcare"]
    totals = [scope["enron_total"], scope["healthcare_total"]]
    bars = axes[0].bar(
        datasets,
        totals,
        color=[PALETTE["blue"], PALETTE["teal"]],
        width=0.55,
    )
    add_panel_title(axes[0], "Dataset Scope", "Total records used by the manuscript benchmark tracks")
    axes[0].set_ylabel("Records")
    axes[0].yaxis.set_major_formatter(lambda value, _: f"{int(value):,}")
    for bar, total in zip(bars, totals):
        axes[0].text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height(),
            f"{total:,}",
            ha="center",
            va="bottom",
            fontsize=9,
            color=PALETTE["slate"],
        )

    healthcare_parts = np.array([scope["eicu"], scope["medcd"], scope["openfda"]])
    labels = ["eICU", "MedCD", "openFDA"]
    colors = [PALETTE["blue"], PALETTE["orange"], PALETTE["green"]]
    left = 0
    for value, label, color in zip(healthcare_parts, labels, colors):
        axes[1].barh(["Healthcare"], [value], left=left, color=color, height=0.45, label=label)
        axes[1].text(
            left + value / 2,
            0,
            f"{label}\n{value:,}",
            ha="center",
            va="center",
            fontsize=9,
            color="white" if color != PALETTE["gold"] else PALETTE["slate"],
            fontweight="bold",
        )
        left += value
    add_panel_title(axes[1], "Healthcare Composition", "Heterogeneous clinical and regulatory corpus breakdown")
    axes[1].set_xlabel("Records")
    axes[1].xaxis.set_major_formatter(lambda value, _: f"{int(value):,}")
    axes[1].legend(frameon=False, loc="lower right")

    save_figure(fig, "figure_02_dataset_composition")


def figure_03_search_vs_verification() -> None:
    rows = read_csv(HEALTHCARE_PHASE_CSV)
    labels = [row["query_type"] for row in rows]
    search = [float(row["mean_search_ms"]) for row in rows]
    verify = [float(row["mean_verify_ms"]) for row in rows]
    y = np.arange(len(labels))

    fig, ax = plt.subplots(figsize=(12.5, 6.8), constrained_layout=True)
    ax.barh(y, search, color=PALETTE["blue"], label="Search", height=0.7)
    ax.barh(y, verify, left=search, color=PALETTE["orange"], label="Verification", height=0.7)
    ax.set_yticks(y)
    ax.set_yticklabels(labels)
    ax.invert_yaxis()
    ax.set_xlabel("Mean latency (ms)")
    add_panel_title(ax, "Search vs Verification Latency", "Healthcare benchmark families")
    ax.legend(frameon=False, loc="lower right", ncol=2)

    for i, (s, v) in enumerate(zip(search, verify)):
        ax.text(s + v + max(search + verify) * 0.01, i, f"{s + v:.1f}", va="center", fontsize=8.5, color=PALETTE["slate"])

    save_figure(fig, "figure_03_search_vs_verification_latency")


def figure_04_auth_overhead() -> None:
    rows = sorted(read_csv(HEALTHCARE_PHASE_CSV), key=lambda row: float(row["auth_share_pct"]), reverse=True)
    labels = [row["query_type"] for row in rows]
    values = [float(row["auth_share_pct"]) for row in rows]

    fig, ax = plt.subplots(figsize=(12.5, 5.4), constrained_layout=True)
    bars = ax.bar(labels, values, color=PALETTE["teal"], width=0.72)
    ax.set_ylabel("Authentication share of total latency (%)")
    ax.set_ylim(0, 105)
    add_panel_title(ax, "Authentication Overhead Percentage", "Authentication dominates the heavier verified families")
    ax.tick_params(axis="x", rotation=35)
    for bar, value in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width() / 2, value + 1.2, f"{value:.1f}%", ha="center", va="bottom", fontsize=8.4)
    save_figure(fig, "figure_04_authentication_overhead_percentage")


def figure_05_ablation() -> None:
    rows = read_csv(ABLATION_CSV)
    stages = [row["stage"] for row in rows]
    latency = [float(row["latency_mean_ms"]) for row in rows]
    memory_mb = [max(float(row["memory_delta_mean_bytes"]) / (1024 * 1024), 0) for row in rows]
    proof = [float(row["proof_size_mean_bytes"]) for row in rows]

    fig, axes = plt.subplots(3, 1, figsize=(12.5, 9.2), constrained_layout=True)
    colors = [PALETTE["blue"], PALETTE["orange"], PALETTE["green"]]
    series = [
        (latency, "Latency (ms)", colors[0]),
        (memory_mb, "Memory delta (MiB)", colors[1]),
        (proof, "Proof size (bytes)", colors[2]),
    ]

    for ax, (values, ylabel, color) in zip(axes, series):
        ax.plot(stages, values, marker="o", linewidth=2.2, markersize=6, color=color)
        ax.set_ylabel(ylabel)
        ax.tick_params(axis="x", rotation=20)
    add_panel_title(axes[0], "Ablation Study", "From baseline postings to integrated PrivSearch")
    axes[-1].set_xlabel("Ablation stage")
    save_figure(fig, "figure_05_ablation_study")


def figure_06_scalability_posting_size() -> None:
    data = read_json(SCALABILITY_JSON)
    rows = data["posting_list_rows"]
    x = [float(row["mean_doc_freq"]) for row in rows]
    total = [float(row["total_stats"]["mean"]) for row in rows]
    fig, ax = plt.subplots(figsize=(11.8, 5.2), constrained_layout=True)
    ax.plot(x, total, marker="o", color=PALETTE["purple"], linewidth=2.3, markersize=6)
    ax.fill_between(x, total, color=PALETTE["purple_light"], alpha=0.35)
    ax.set_xscale("log")
    ax.set_xlabel("Mean posting frequency (documents)")
    ax.set_ylabel("Mean latency (ms)")
    add_panel_title(ax, "Scalability vs Posting List Size", "Latency rises with posting-list breadth under authenticated retrieval")
    save_figure(fig, "figure_06_scalability_vs_posting_list_size")


def figure_07_scalability_clause_count() -> None:
    rows = read_csv(SCALABILITY_CLAUSE_CSV)
    mode_map: dict[str, list[tuple[int, float]]] = {}
    for row in rows:
        if row["mode"] not in {"conjunctive", "disjunctive", "dnf"}:
            continue
        mode_map.setdefault(row["mode"], []).append((int(row["clause_count"]), float(row["mean_total_ms"])))

    fig, ax = plt.subplots(figsize=(11.8, 5.2), constrained_layout=True)
    mode_styles = {
        "conjunctive": (PALETTE["blue"], "o", "AND"),
        "disjunctive": (PALETTE["orange"], "s", "OR"),
        "dnf": (PALETTE["green"], "^", "DNF"),
    }
    for mode, points in mode_map.items():
        points = sorted(points)
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        color, marker, label = mode_styles[mode]
        ax.plot(xs, ys, marker=marker, color=color, linewidth=2.2, markersize=6, label=label)
    add_panel_title(ax, "Scalability vs Clause Count", "Clause growth affects AND, OR, and DNF workloads differently")
    ax.set_xlabel("Number of clauses")
    ax.set_ylabel("Mean latency (ms)")
    ax.legend(frameon=False, ncol=3, loc="upper left")
    save_figure(fig, "figure_07_scalability_vs_clause_count")


def figure_08_concurrent_users() -> None:
    rows = read_csv(SCALABILITY_CONCURRENCY_CSV)
    aggregate: dict[int, dict[str, list[float]]] = {}
    for row in rows:
        concurrency = int(row["concurrency"])
        aggregate.setdefault(concurrency, {"latency": [], "throughput": []})
        aggregate[concurrency]["latency"].append(float(row["mean_total_ms"]))
        aggregate[concurrency]["throughput"].append(float(row["throughput_rps"]))

    x = sorted(aggregate)
    latency = [np.mean(aggregate[c]["latency"]) for c in x]
    throughput = [np.mean(aggregate[c]["throughput"]) for c in x]

    fig, ax1 = plt.subplots(figsize=(11.8, 5.2), constrained_layout=True)
    ax2 = ax1.twinx()
    l1 = ax1.plot(x, latency, color=PALETTE["blue"], marker="o", linewidth=2.2, label="Latency")
    l2 = ax2.plot(x, throughput, color=PALETTE["orange"], marker="s", linewidth=2.2, label="Throughput")
    add_panel_title(ax1, "Concurrent Users", "Aggregate view across representative authenticated workload families")
    ax1.set_xlabel("Concurrent users")
    ax1.set_ylabel("Mean latency (ms)", color=PALETTE["blue"])
    ax2.set_ylabel("Throughput (requests/s)", color=PALETTE["orange"])
    lines = l1 + l2
    labels = [line.get_label() for line in lines]
    ax1.legend(lines, labels, frameon=False, loc="upper left")
    save_figure(fig, "figure_08_concurrent_users")


def figure_09_crypto_breakdown() -> None:
    rows = read_csv(CRYPTO_CSV)
    labels = [row["query_type"] for row in rows]
    trapdoor = [float(row["mean_trapdoor_generation_ms"]) for row in rows]
    retrieval = [float(row["mean_encrypted_postings_retrieval_ms"]) for row in rows]
    proof_construction = [float(row["mean_proof_construction_ms"]) for row in rows]
    proof_verification = [float(row["mean_proof_verification_ms"]) for row in rows]
    blockchain = [float(row["mean_blockchain_verification_ms"]) for row in rows]

    totals = np.array(trapdoor) + np.array(retrieval) + np.array(proof_construction) + np.array(proof_verification) + np.array(blockchain)
    trapdoor_pct = np.divide(np.array(trapdoor), totals, out=np.zeros_like(totals), where=totals > 0) * 100
    retrieval_pct = np.divide(np.array(retrieval), totals, out=np.zeros_like(totals), where=totals > 0) * 100
    proof_construction_pct = np.divide(np.array(proof_construction), totals, out=np.zeros_like(totals), where=totals > 0) * 100
    proof_verification_pct = np.divide(np.array(proof_verification), totals, out=np.zeros_like(totals), where=totals > 0) * 100
    blockchain_pct = np.divide(np.array(blockchain), totals, out=np.zeros_like(totals), where=totals > 0) * 100

    fig, axes = plt.subplots(1, 2, figsize=(14.2, 5.8), constrained_layout=True, gridspec_kw={"width_ratios": [1.2, 1.0]})
    x = np.arange(len(labels))
    width = 0.72
    edge = "white"

    axes[0].bar(x, trapdoor, color=PALETTE["blue"], label="Trapdoor", width=width, edgecolor=edge, linewidth=0.8)
    axes[0].bar(x, retrieval, bottom=trapdoor, color=PALETTE["teal"], label="Retrieval", width=width, edgecolor=edge, linewidth=0.8)
    bottom2 = np.array(trapdoor) + np.array(retrieval)
    axes[0].bar(x, proof_construction, bottom=bottom2, color=PALETTE["gold"], label="Proof construction", width=width, edgecolor=edge, linewidth=0.8)
    bottom3 = bottom2 + np.array(proof_construction)
    axes[0].bar(x, proof_verification, bottom=bottom3, color=PALETTE["orange"], label="Proof verification", width=width, edgecolor=edge, linewidth=0.8)
    bottom4 = bottom3 + np.array(proof_verification)
    axes[0].bar(x, blockchain, bottom=bottom4, color=PALETTE["purple"], label="Blockchain verification", width=width, edgecolor=edge, linewidth=0.8)
    axes[0].set_xticks(x)
    axes[0].set_xticklabels(labels, rotation=20)
    axes[0].set_ylabel("Mean latency (ms)")
    add_panel_title(axes[0], "Cryptographic Overhead Breakdown", "Absolute phase latency")
    for i, total in enumerate(totals):
        axes[0].text(i, total + max(totals) * 0.012, f"{total:.1f}", ha="center", va="bottom", fontsize=8.4, color=PALETTE["slate"])

    axes[1].bar(x, trapdoor_pct, color=PALETTE["blue"], width=width, edgecolor=edge, linewidth=0.8)
    axes[1].bar(x, retrieval_pct, bottom=trapdoor_pct, color=PALETTE["teal"], width=width, edgecolor=edge, linewidth=0.8)
    pct_bottom2 = trapdoor_pct + retrieval_pct
    axes[1].bar(x, proof_construction_pct, bottom=pct_bottom2, color=PALETTE["gold"], width=width, edgecolor=edge, linewidth=0.8)
    pct_bottom3 = pct_bottom2 + proof_construction_pct
    axes[1].bar(x, proof_verification_pct, bottom=pct_bottom3, color=PALETTE["orange"], width=width, edgecolor=edge, linewidth=0.8)
    pct_bottom4 = pct_bottom3 + proof_verification_pct
    axes[1].bar(x, blockchain_pct, bottom=pct_bottom4, color=PALETTE["purple"], width=width, edgecolor=edge, linewidth=0.8)
    axes[1].set_xticks(x)
    axes[1].set_xticklabels(labels, rotation=20)
    axes[1].set_ylim(0, 100)
    axes[1].set_ylabel("Share of total cryptographic cost (%)")
    add_panel_title(axes[1], "Phase Composition", "Normalized contribution so minor phases remain visible")
    for i, value in enumerate(proof_verification_pct):
        if value > 45:
            axes[1].text(i, 50, f"{value:.1f}%", ha="center", va="center", fontsize=8.3, color="white", fontweight="bold")

    handles, labels_legend = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels_legend, frameon=False, ncol=3, loc="upper center", bbox_to_anchor=(0.5, 1.02))
    save_figure(fig, "figure_09_cryptographic_overhead_breakdown")


def figure_10_replay_results() -> None:
    row = read_csv(REPLAY_CSV)[0]
    counts = [int(row["accepted"]), int(row["rejected"])]
    latencies = [float(row["accepted_mean_ms"]), float(row["replay_mean_ms"])]
    labels = ["Accepted", "Rejected replay"]

    fig, axes = plt.subplots(1, 2, figsize=(11.8, 4.8), constrained_layout=True)
    bars = axes[0].bar(labels, counts, color=[PALETTE["green"], PALETTE["red"]], width=0.58)
    add_panel_title(axes[0], "Replay Outcomes", "Fresh writes accepted; repeated requests rejected")
    axes[0].set_ylabel("Requests")
    for bar, value in zip(bars, counts):
        axes[0].text(bar.get_x() + bar.get_width() / 2, value, f"{value}", ha="center", va="bottom")

    bars2 = axes[1].bar(labels, latencies, color=[PALETTE["blue"], PALETTE["orange"]], width=0.58)
    add_panel_title(axes[1], "Replay Latency", "Mean processing latency for accepted and rejected requests")
    axes[1].set_ylabel("Mean latency (ms)")
    for bar, value in zip(bars2, latencies):
        axes[1].text(bar.get_x() + bar.get_width() / 2, value, f"{value:.2f}", ha="center", va="bottom")
    save_figure(fig, "figure_10_replay_attack_results")


def figure_11_distributed_validation() -> None:
    rows = read_csv(DISTRIBUTED_WAN_CSV)
    profiles = [
        ("LAN", PALETTE["blue"]),
        ("Regional WAN", PALETTE["orange"]),
        ("Cross-Site WAN", PALETTE["red"]),
    ]
    fig, ax = plt.subplots(figsize=(11.8, 5.2), constrained_layout=True)
    for label, color in profiles:
        profile_rows = [row for row in rows if row["profile_label"] == label]
        xs = [int(row["nodes"]) for row in profile_rows]
        ys = [float(row["end_to_end_threshold_mean_ms"]) for row in profile_rows]
        ax.plot(xs, ys, marker="o", linewidth=2.2, markersize=6, color=color, label=label)
    add_panel_title(ax, "Distributed Validation", "Threshold-path latency under LAN, Regional WAN, and Cross-Site WAN profiles")
    ax.set_xlabel("Number of validator nodes")
    ax.set_ylabel("End-to-end threshold latency (ms)")
    ax.legend(frameon=False, ncol=3, loc="upper left")
    save_figure(fig, "figure_11_distributed_validation")


def figure_12_resource_overhead() -> None:
    data = read_json(RESOURCE_JSON)
    rows = {row["query_type"]: row for row in data["summary_by_query_type"]}
    selected = ["single_keyword", "and_2", "or_2", "range_month_1", "semantic_v1"]
    labels = ["single", "AND-2", "OR-2", "range-month", "semantic-v1"]

    cpu = [rows[key]["mean_cpu_ms"] for key in selected]
    memory = [abs(rows[key]["mean_heap_delta_bytes"]) / (1024 * 1024) for key in selected]
    network = [rows[key]["mean_network_total_bytes"] / 1024 for key in selected]
    proof = [rows[key]["mean_proof_size_bytes"] for key in selected]

    fig, axes = plt.subplots(2, 3, figsize=(13.2, 8.2), constrained_layout=True)
    axes = axes.ravel()
    panels = [
        ("CPU", cpu, "Mean CPU time (ms)", PALETTE["blue"]),
        ("Memory", memory, "Absolute heap delta (MiB)", PALETTE["orange"]),
        ("Network", network, "Mean network traffic (KiB)", PALETTE["teal"]),
        ("Proof Size", proof, "Mean proof size (bytes)", PALETTE["purple"]),
    ]

    for ax, (title, values, ylabel, color) in zip(axes[:4], panels):
        ax.bar(labels, values, color=color, width=0.62)
        add_panel_title(ax, title)
        ax.set_ylabel(ylabel)
        ax.tick_params(axis="x", rotation=20)

    storage_labels = ["Raw postings", "Encrypted index", "Blockchain\ncommitments"]
    storage_values = [
        data["prepared_resources"]["raw_postings_bytes"] / (1024 * 1024),
        data["prepared_resources"]["encrypted_index_size_bytes"] / (1024 * 1024),
        data["prepared_resources"]["blockchain_commitment_bytes"] / 1024,
    ]
    storage_colors = [PALETTE["slate_light"], PALETTE["green"], PALETTE["gold"]]
    axes[4].bar(storage_labels, storage_values, color=storage_colors, width=0.62)
    add_panel_title(axes[4], "Storage")
    axes[4].set_ylabel("Size (MiB for first two, KiB for commitments)")
    axes[4].text(
        0.5,
        0.95,
        f"Storage ratio ≈ {data['prepared_resources']['storage_overhead_ratio']:.3f}×",
        transform=axes[4].transAxes,
        ha="center",
        va="top",
        fontsize=9,
        color=PALETTE["slate"],
    )

    axes[5].set_axis_off()
    axes[5].text(
        0.03,
        0.94,
        "Resource Overhead Summary",
        transform=axes[5].transAxes,
        ha="left",
        va="top",
        fontsize=14,
        fontweight="bold",
        color=PALETTE["slate"],
    )
    axes[5].text(
        0.03,
        0.76,
        "Representative query families:\n"
        "- single keyword\n"
        "- AND-2\n"
        "- OR-2\n"
        "- range_month_1\n"
        "- semantic_v1\n\n"
        "Global storage values are taken from the prepared\n"
        "encrypted-index benchmark state.",
        transform=axes[5].transAxes,
        ha="left",
        va="top",
        fontsize=10,
        color="#475569",
        linespacing=1.45,
    )

    save_figure(fig, "figure_12_resource_overhead")


def write_manifest() -> None:
    lines = [
        "# PrivSearch IEEE Transactions Figures",
        "",
        "This folder contains 12 manuscript-ready PrivSearch figures generated from the current local benchmark artifacts.",
        "",
        "## Figures",
        "- figure_01_experimental_pipeline",
        "- figure_02_dataset_composition",
        "- figure_03_search_vs_verification_latency",
        "- figure_04_authentication_overhead_percentage",
        "- figure_05_ablation_study",
        "- figure_06_scalability_vs_posting_list_size",
        "- figure_07_scalability_vs_clause_count",
        "- figure_08_concurrent_users",
        "- figure_09_cryptographic_overhead_breakdown",
        "- figure_10_replay_attack_results",
        "- figure_11_distributed_validation",
        "- figure_12_resource_overhead",
    ]
    (OUTPUT_DIR / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    configure_style()
    ensure_output_dir()
    figure_01_pipeline()
    figure_02_dataset_composition()
    figure_03_search_vs_verification()
    figure_04_auth_overhead()
    figure_05_ablation()
    figure_06_scalability_posting_size()
    figure_07_scalability_clause_count()
    figure_08_concurrent_users()
    figure_09_crypto_breakdown()
    figure_10_replay_results()
    figure_11_distributed_validation()
    figure_12_resource_overhead()
    write_manifest()
    print(OUTPUT_DIR)


if __name__ == "__main__":
    main()
