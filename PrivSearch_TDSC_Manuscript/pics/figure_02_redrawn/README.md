# Redrawn Fig. 2 — Authentication-overhead share (healthcare corpus)

## Files

| File | Use |
|---|---|
| `figure_02_authentication_overhead_share.pdf` | **Primary.** Vector, fonts embedded (Type 42). Use this in LaTeX. |
| `figure_02_authentication_overhead_share.png` | 600 dpi raster preview. |
| `figure_02_authentication_overhead_share_grayscale_safe.pdf` | Same figure with texture on two of the three phases; fully legible in pure B&W print. |
| `figure_02_authentication_overhead_share_grayscale_safe.png` | 600 dpi raster preview of the above. |
| `make_fig.py` | Generator. Re-run to regenerate both variants. |

Regenerate:

```
python3 make_fig.py            # colour
python3 make_fig.py --hatch    # grayscale-safe
```

## Data provenance

Built from the **100-trial** healthcare run:

```
NweDB/benchmark_runs/healthcare_privsearch-prototype_2026-07-15T05-48-51-545Z/
  benchmark_summary.csv          (258 workloads, 100 trials each, 0 verification failures)
```

The generator prints a reconciliation against Table III on every run:

```
weighted mean total    3.3871 ms   (manuscript 3.3871)
weighted mean search   0.6583 ms   (manuscript 0.6583)
weighted mean verify   2.6937 ms   (manuscript 2.6937)
weighted auth overhead 2.7288 ms   (manuscript 2.7288)
weighted auth share    80.56 %     (manuscript 80.57)
```

**The previous version of this figure was generated from the superseded 10-trial
run** — it showed `and_2` at 61.7 ms (the 61.6895 ms value Section IV-I explicitly
describes as unrepresentative), `and_4` at 153.2 ms, and `range_year_2` at 369.2 ms,
against the current 4.7188 / 12.2154 / 28.2744 ms. It therefore contradicted both
Table III and Table IV.

## LaTeX

The figure is drawn at IEEE **double-column** width (7.16 in), so it needs
`figure*`, not `figure`:

```latex
\begin{figure*}[t]
\centering
\includegraphics[width=\textwidth]{pics/figure_02_authentication_overhead_share.pdf}
\caption{Latency composition and magnitude across healthcare query families
(258 workloads, 100 trials each). (a)~Share of mean total query latency
attributable to encrypted search, setup (trapdoor generation and clause
preparation), and proof verification; the authentication share is the
setup-plus-verification portion and is printed at the right. The dashed rule
marks the 258-workload weighted mean of 80.57\%. (b)~Mean total latency on a
logarithmic axis. Families are ordered by authentication share. Verification
dominates the conjunctive, temporal-range, and OR-of-AND families, whereas the
disjunctive and fuzzy families remain search-bound; note from~(b) that a high
authentication share does not imply a high absolute cost --- OR-of-AND is
96.88\% authentication at only 0.18~ms.}
\label{fig:hcauth}
\end{figure*}
```

If it must stay single-column, drop panel (b) and keep panel (a) alone — do not
scale the two-panel figure into 3.5 in.

## Design notes

- Palette: categorical slots 1–3 of the validated default palette. Verified with
  the six-check validator (`--pairs all`, light surface): lightness band PASS,
  chroma floor PASS, worst CVD ΔE 9.2 PASS, worst normal-vision ΔE 24.0 PASS.
  Slot 3 sits below 3:1 contrast, so the relief rule applies — every segment
  ≥ 7% carries a direct label.
- Type: Liberation Serif (metric-compatible with Times New Roman), 7–8 pt.
- No in-figure title; the caption carries it, per IEEE style.
- Panel (b) is a dot plot rather than bars because the axis is logarithmic and a
  bar would not be anchored at zero.
