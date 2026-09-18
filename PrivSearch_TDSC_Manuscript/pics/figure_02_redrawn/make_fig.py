#!/usr/bin/env python3
"""
IEEE-standard replacement for figure_02_authentication_overhead_share.

Source of truth: the 100-trial healthcare run
  NweDB/benchmark_runs/healthcare_privsearch-prototype_2026-07-15T05-48-51-545Z/
  benchmark_summary.csv   (258 workloads, 100 trials each, 0 verification failures)

Panel (a) 100% stacked latency composition per query family, ordered by
          authentication share; the Search|Setup boundary IS the authentication
          threshold, so the dashed rule marks the 258-workload weighted mean.
Panel (b) mean total latency, log axis, dot plot (position encoding - a bar on a
          log axis would not be anchored at zero).
"""
import csv
import os
import sys

HATCH = '--hatch' in sys.argv   # print / grayscale-safe variant
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
from matplotlib.ticker import FuncFormatter

SRC = ('/mnt/user-data/uploads/lifedb ICMIC/NweDB/benchmark_runs/'
       'healthcare_privsearch-prototype_2026-07-15T05-48-51-545Z/benchmark_summary.csv')
OUTDIR = os.path.dirname(os.path.abspath(__file__))

# ---- design tokens -------------------------------------------------------
SURFACE   = '#fcfcfb'
INK       = '#0b0b0b'
INK_2     = '#52514e'
MUTED     = '#898781'
GRID      = '#e1e0d9'
BASELINE  = '#c3c2b7'
S_SEARCH  = '#2a78d6'   # categorical slot 1
S_SETUP   = '#eb6834'   # categorical slot 2
S_VERIFY  = '#1baf7a'   # categorical slot 3  (relief: direct labels, see below)

plt.rcParams.update({
    'hatch.linewidth': 0.45,
    'font.family': 'serif',
    'font.serif': ['Liberation Serif', 'Times New Roman', 'DejaVu Serif'],
    'mathtext.fontset': 'stix',
    'axes.linewidth': 0.5,
    'xtick.major.width': 0.5,
    'ytick.major.width': 0.0,
    'pdf.fonttype': 42,     # embed TrueType, editable text
    'ps.fonttype': 42,
    'savefig.facecolor': SURFACE,
    'figure.facecolor': SURFACE,
})

PRETTY = {
    'single_keyword': 'Single keyword', 'and_2': 'AND-2', 'and_4': 'AND-4',
    'or_2': 'OR-2', 'or_3': 'OR-3', 'or_of_and': 'OR-of-AND',
    'fuzzy_1': 'Fuzzy (ed $\\leq$ 1)', 'semantic_v1': 'Semantic v1',
    'range_month_1': 'Range: 1 month', 'range_month_3': 'Range: 3 months',
    'range_year_2': 'Range: 2 years', 'range_year_3': 'Range: 3 years',
}


def load():
    rows = []
    with open(SRC, newline='') as fh:
        for r in csv.DictReader(fh):
            n = int(r['query_count'])
            total = float(r['mean_total_ms'])
            search = float(r['mean_search_ms'])
            setup = float(r['mean_setup_ms'])
            verify = float(r['mean_verify_ms'])
            rows.append(dict(
                key=r['query_type'], label=PRETTY[r['query_type']], n=n,
                total=total, search=search, setup=setup, verify=verify,
                auth=(total - search) / total * 100.0,
                p_search=search / total * 100.0,
                p_setup=setup / total * 100.0,
                p_verify=verify / total * 100.0,
            ))
    return rows


def main():
    rows = load()

    # weighted global metrics -> must reproduce Table III of the manuscript
    N = sum(r['n'] for r in rows)
    w = lambda k: sum(r[k] * r['n'] for r in rows) / N
    wt, ws, wv = w('total'), w('search'), w('verify')
    w_auth = (wt - ws) / wt * 100.0
    w_search_share = ws / wt * 100.0
    print(f'workloads              {N}')
    print(f'weighted mean total    {wt:.4f} ms   (manuscript 3.3871)')
    print(f'weighted mean search   {ws:.4f} ms   (manuscript 0.6583)')
    print(f'weighted mean verify   {wv:.4f} ms   (manuscript 2.6937)')
    print(f'weighted auth overhead {wt-ws:.4f} ms   (manuscript 2.7288)')
    print(f'weighted auth share    {w_auth:.2f} %    (manuscript 80.57)')
    print()

    rows.sort(key=lambda r: r['auth'])          # ascending -> largest on top
    y = range(len(rows))
    labels = [r['label'] for r in rows]

    fig, (axA, axB) = plt.subplots(
        1, 2, figsize=(7.16, 3.45), sharey=True,
        gridspec_kw=dict(width_ratios=[2.6, 1.0], wspace=0.10,
                         left=0.150, right=0.985, top=0.845, bottom=0.135))

    BH = 0.66

    # ---------------- panel (a): composition ------------------------------
    for i, r in enumerate(rows):
        left = 0.0
        for val, col, htc in ((r['p_search'], S_SEARCH, None),
                              (r['p_setup'], S_SETUP, '....' if HATCH else None),
                              (r['p_verify'], S_VERIFY, '///' if HATCH else None)):
            axA.barh(i, val, left=left, height=BH, color=col, hatch=htc,
                     edgecolor=SURFACE, linewidth=0.8, zorder=3, clip_on=False)
            left += val

    # direct labels (the documented relief for the sub-3:1 slot)
    for i, r in enumerate(rows):
        if r['p_search'] >= 7:
            axA.text(r['p_search'] / 2, i, f"{r['p_search']:.0f}",
                     ha='center', va='center', fontsize=6.6, color='white', zorder=4)
        if r['p_setup'] >= 7:
            axA.text(r['p_search'] + r['p_setup'] / 2, i, f"{r['p_setup']:.0f}",
                     ha='center', va='center', fontsize=6.6, color='white', zorder=4)
        # authentication share (= setup + verification), outside the bar
        axA.text(115.5, i, f"{r['auth']:.2f}", ha='right', va='center',
                 fontsize=7.0, color=INK_2, zorder=4)

    axA.axvline(w_search_share, color=INK_2, lw=0.7, ls=(0, (3, 2)), zorder=5)
    axA.annotate(f'weighted mean\n{w_auth:.1f}% auth.',
                 xy=(w_search_share, len(rows) - 0.42), xytext=(w_search_share + 2.5,
                                                                len(rows) - 0.30),
                 fontsize=6.6, color=INK_2, ha='left', va='center', clip_on=False)

    axA.set_xlim(0, 116)
    axA.set_xticks([0, 20, 40, 60, 80, 100])
    axA.set_xlabel('Share of mean total query latency (%)', fontsize=8, color=INK)
    axA.set_ylim(-0.62, len(rows) - 0.38)
    axA.set_yticks(list(y))
    axA.set_yticklabels(labels, fontsize=7.6, color=INK)
    axA.text(115.5, len(rows) - 0.40, 'Auth. (%)', fontsize=6.8, color=MUTED,
             ha='right', va='center', clip_on=False)
    axA.set_title('(a)', fontsize=8, color=INK, loc='left', pad=14)

    # ---------------- panel (b): magnitude --------------------------------
    for i, r in enumerate(rows):
        axB.plot([r['total']], [i], marker='o', ms=4.4, color=INK_2,
                 mec=SURFACE, mew=0.7, zorder=4, clip_on=False)
        axB.text(r['total'] * 1.30, i, f"{r['total']:.2f}", ha='left', va='center',
                 fontsize=7.0, color=INK_2)

    axB.set_xscale('log')
    axB.set_xlim(0.1, 120)
    axB.set_xticks([0.1, 1, 10, 100])
    axB.xaxis.set_major_formatter(FuncFormatter(
        lambda v, _: ('%g' % v) if v >= 1 else '0.1'))
    axB.set_xlabel('Mean total latency (ms, log)', fontsize=8, color=INK)
    axB.set_title('(b)', fontsize=8, color=INK, loc='left', pad=14)

    # ---------------- shared chrome ---------------------------------------
    for ax in (axA, axB):
        ax.xaxis.grid(True, color=GRID, lw=0.5)
        ax.set_axisbelow(True)
        for s in ('top', 'right', 'left'):
            ax.spines[s].set_visible(False)
        ax.spines['bottom'].set_color(BASELINE)
        ax.tick_params(axis='x', labelsize=7.2, colors=MUTED, length=2.5, pad=2)
        ax.tick_params(axis='y', length=0, pad=3)
        ax.tick_params(axis='x', which='minor', length=1.4, width=0.4, colors=MUTED)
    axA.spines['bottom'].set_bounds(0, 100)
    axA.set_facecolor(SURFACE)
    axB.set_facecolor(SURFACE)

    handles = [Patch(fc=S_SEARCH, ec=SURFACE, lw=0.8, label='Encrypted search'),
               Patch(fc=S_SETUP, ec=SURFACE, lw=0.8, label='Setup (trapdoor gen.)',
                     hatch='....' if HATCH else None),
               Patch(fc=S_VERIFY, ec=SURFACE, lw=0.8, label='Proof verification',
                     hatch='///' if HATCH else None)]
    fig.legend(handles=handles, loc='upper left', bbox_to_anchor=(0.155, 0.995),
               ncol=3, frameon=False, fontsize=7.4, handlelength=1.15,
               handleheight=0.82, handletextpad=0.45, columnspacing=1.5,
               labelcolor=INK)

    stem = ('figure_02_authentication_overhead_share'
            + ('_grayscale_safe' if HATCH else ''))
    for ext in ('pdf', 'png'):
        p = os.path.join(OUTDIR, f'{stem}.{ext}')
        fig.savefig(p, dpi=600, bbox_inches='tight', pad_inches=0.02)
        print('wrote', p)

    # ---- printed audit trail -------------------------------------------
    print(f"\n{'family':<16}{'n':>4}{'total':>9}{'search':>9}{'setup':>8}"
          f"{'verify':>9}{'auth%':>8}")
    for r in sorted(rows, key=lambda r: -r['auth']):
        print(f"{r['key']:<16}{r['n']:>4}{r['total']:>9.4f}{r['search']:>9.4f}"
              f"{r['setup']:>8.4f}{r['verify']:>9.4f}{r['auth']:>8.2f}")


main()
