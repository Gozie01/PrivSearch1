from __future__ import annotations

import csv
import os
from pathlib import Path

import matplotlib.pyplot as plt
from mpl_toolkits.axes_grid1.inset_locator import inset_axes


ROOT = Path(__file__).resolve().parents[1]
BENCHMARK_ROOT = ROOT / "NweDB" / "benchmark_runs"


def resolve_run_dir() -> Path:
    run_dir_env = os.environ.get("SEACQ_RUN_DIR", "").strip()
    run_id_env = os.environ.get("SEACQ_RUN_ID", "").strip()

    if run_dir_env:
        return (ROOT / run_dir_env).resolve()

    if run_id_env:
        return (BENCHMARK_ROOT / run_id_env).resolve()

    candidates = sorted(
        [path for path in BENCHMARK_ROOT.iterdir() if path.is_dir() and path.name.startswith("seacq_comparison_")],
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(f"No SeaCQ comparison run directories found in {BENCHMARK_ROOT}")
    return candidates[0]


def read_table(table_path: Path) -> list[dict[str, str]]:
    with table_path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def numeric(value: str) -> float:
    return float(value)


def build_series(rows: list[dict[str, str]]) -> dict[str, list[tuple[int, float, float]]]:
    series: dict[str, list[tuple[int, float, float]]] = {
        "search": [],
        "verify": [],
    }

    for row in sorted(rows, key=lambda item: int(item["query_type"].split("_")[1])):
        keyword_count = int(row["query_type"].split("_")[1])
        series["search"].append(
            (
                keyword_count,
                numeric(row["privsearch_mean_search_ms"]),
                numeric(row["seacq_published_search_ms"]),
            )
        )
        series["verify"].append(
            (
                keyword_count,
                numeric(row["privsearch_mean_verify_ms"]),
                numeric(row["seacq_published_verify_ms"]),
            )
        )

    return series


def style_axis(ax, title: str, ylabel: str, x_values: list[int], y_max: float) -> None:
    ax.set_title(title, fontsize=14, fontweight="bold", pad=10)
    ax.set_xlabel("Number of query keywords", fontsize=12)
    ax.set_ylabel(ylabel, fontsize=12)
    ax.set_xticks(x_values)
    ax.set_xlim(min(x_values) - 0.5, max(x_values) + 0.5)
    ax.set_ylim(0, y_max)
    ax.grid(True, axis="both", linestyle="--", linewidth=0.7, alpha=0.45)
    for spine in ax.spines.values():
        spine.set_linewidth(1.0)


def add_inset(ax, x_values: list[int], priv_values: list[float], color: str, marker: str) -> None:
    inset = inset_axes(ax, width="37%", height="42%", loc="upper left", borderpad=1.0)
    inset.plot(
        x_values,
        priv_values,
        color=color,
        marker=marker,
        linewidth=1.8,
        markersize=4.5,
    )
    inset.set_xticks(x_values)
    inset.tick_params(axis="both", labelsize=7)
    inset.grid(True, linestyle=":", linewidth=0.5, alpha=0.4)
    inset.set_title("PrivSearch zoom", fontsize=7, pad=2)
    inset.set_xlim(min(x_values) - 0.25, max(x_values) + 0.25)
    inset.set_ylim(0, max(priv_values) * 1.25 if max(priv_values) > 0 else 1)
    for spine in inset.spines.values():
        spine.set_linewidth(0.8)


def main() -> None:
    run_dir = resolve_run_dir()
    table_path = run_dir / "seacq_comparison_table.csv"
    rows = read_table(table_path)
    series = build_series(rows)

    x_values = [point[0] for point in series["search"]]
    priv_search = [point[1] for point in series["search"]]
    seacq_search = [point[2] for point in series["search"]]
    priv_verify = [point[1] for point in series["verify"]]
    seacq_verify = [point[2] for point in series["verify"]]

    plt.rcParams.update({
        "font.size": 11,
        "font.family": "DejaVu Sans",
    })

    fig, axes = plt.subplots(1, 2, figsize=(10.8, 4.3), constrained_layout=True)
    fig.suptitle("PrivSearch vs SeaCQ with SeaCQ-Style Keyword-Sweep Plots", fontsize=16, fontweight="bold")

    priv_color = "#0f766e"
    seacq_color = "#b45309"

    search_max = max(seacq_search) * 1.10
    verify_max = max(seacq_verify) * 1.10

    style_axis(axes[0], "(a) R finding time cost", "Time (ms)", x_values, search_max)
    axes[0].plot(x_values, seacq_search, color=seacq_color, marker="^", linewidth=2.2, markersize=6, label="SeaCQ")
    axes[0].plot(x_values, priv_search, color=priv_color, marker="*", linewidth=2.0, markersize=9, label="PrivSearch")
    add_inset(axes[0], x_values, priv_search, priv_color, "*")
    axes[0].legend(frameon=False, loc="upper right")

    style_axis(axes[1], "(b) Verification time cost", "Time (ms)", x_values, verify_max)
    axes[1].plot(x_values, seacq_verify, color=seacq_color, marker="^", linewidth=2.2, markersize=6, label="SeaCQ")
    axes[1].plot(x_values, priv_verify, color=priv_color, marker="*", linewidth=2.0, markersize=9, label="PrivSearch")
    add_inset(axes[1], x_values, priv_verify, priv_color, "*")
    axes[1].legend(frameon=False, loc="upper right")

    footer = "SeaCQ values are approximate digitizations from published Fig. 6(a) and Fig. 7(a); PrivSearch values are measured from the 25-workload, 100-trial warm-run benchmark."
    fig.text(0.5, -0.01, footer, ha="center", va="top", fontsize=9)

    png_path = run_dir / "seacq_privsearch_same_style.png"
    svg_path = run_dir / "seacq_privsearch_same_style.svg"
    fig.savefig(png_path, dpi=240, bbox_inches="tight")
    fig.savefig(svg_path, bbox_inches="tight")
    plt.close(fig)

    print(png_path)
    print(svg_path)


if __name__ == "__main__":
    main()
