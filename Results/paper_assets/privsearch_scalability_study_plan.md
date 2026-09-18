# PrivSearch Richer Scalability Evaluation Plan

This file defines the stronger scalability study for the PrivSearch paper. The current evaluation already covers workloads, query families, and WAN-style distributed validation. The next step is to add controlled scaling axes that reveal how PrivSearch behaves as the search space, authentication structures, and user pressure all grow.

## 1. Current Coverage

At present, the PrivSearch experiments already benchmark:

| Existing Dimension | What It Shows |
|---|---|
| workload families | correctness and latency across AND, OR, OR-of-AND, range, fuzzy, and semantic_v1 |
| query-type diversity | expressiveness beyond SeaCQ-style conjunctive search |
| WAN-style distributed validation | validator scaling under LAN, regional WAN, and cross-site delay profiles |
| healthcare corpus validation | broader domain generalization |
| concurrent search benchmark | user-pressure behavior in the existing search stack |

This is good, but a stronger journal paper should also vary the structural properties of the indexed corpus and the query complexity itself.

## 2. New Scalability Axes to Add

The richer scalability study should additionally vary:

| New Axis | Meaning |
|---|---|
| corpus size | number of indexed documents/records |
| keyword vocabulary | number of unique keywords in the searchable dictionary |
| posting-list size | number of documents attached to a queried keyword |
| clause count | number of clauses in OR or OR-of-AND queries |
| concurrent users | number of simultaneous clients issuing queries |

These five axes will make the scalability story much stronger because they separate dataset growth, index complexity, query complexity, and runtime pressure.

## 3. Core Scientific Questions

Each new axis should answer a specific question.

| Axis | Main Question |
|---|---|
| corpus size | Does latency grow gracefully as the database becomes larger? |
| keyword vocabulary | Does encrypted/authenticated indexing remain practical as the dictionary expands? |
| posting-list size | What happens when queried terms become common rather than selective? |
| clause count | How expensive is richer disjunctive expressiveness? |
| concurrent users | Does the system preserve acceptable service under multi-user load? |

## 4. Recommended Scaling Matrix

### 4.1 Corpus-size scaling

Use progressively larger slices of the normalized corpus.

Recommended points:

| Scale Label | Records |
|---|---:|
| C1 | 10,000 |
| C2 | 25,000 |
| C3 | 50,000 |
| C4 | 100,000 |
| C5 | 200,000 |
| C6 | full available corpus |

For healthcare, the full available corpus is currently about `281,042` records. For Enron-derived experiments, use the largest consistent slice that preserves workload generation quality.

### 4.2 Vocabulary-size scaling

Construct index variants with different dictionary sizes.

Recommended points:

| Scale Label | Unique Keywords |
|---|---:|
| V1 | 5,000 |
| V2 | 10,000 |
| V3 | 25,000 |
| V4 | 50,000 |
| V5 | 100,000 |
| V6 | full available vocabulary |

Healthcare already provides a large natural ceiling at roughly `221,760` unique keywords.

### 4.3 Posting-list-size scaling

Group query terms by how large their posting lists are.

Recommended buckets:

| Bucket | Posting-List Cardinality |
|---|---:|
| P1 | 1-10 |
| P2 | 11-100 |
| P3 | 101-1,000 |
| P4 | 1,001-10,000 |
| P5 | 10,001+ |

This experiment is especially important because verification and proof size often depend more on result-set breadth than on query-string length alone.

### 4.4 Clause-count scaling

Increase the number of disjunctive clauses in authenticated OR-style queries.

Recommended points:

| Scale Label | Clause Count |
|---|---:|
| Q1 | 1 |
| Q2 | 2 |
| Q3 | 4 |
| Q4 | 8 |
| Q5 | 16 |

Use this for:

- plain OR queries
- OR-of-AND queries with small fixed conjunctive clause size

This will show how PrivSearch scales not just with keyword count, but with authenticated clause composition.

### 4.5 Concurrent-user scaling

Extend the current concurrency benchmark to align with the PrivSearch query engine directly.

Recommended points:

| Scale Label | Concurrent Users |
|---|---:|
| U1 | 1 |
| U2 | 5 |
| U3 | 10 |
| U4 | 25 |
| U5 | 50 |
| U6 | 100 |
| U7 | 200 |

If feasible, add `500` for a stress-only run, but do not let that replace the cleaner 1-200 matrix.

## 5. What to Measure on Every Curve

Every scalability curve should report the same core metrics so the paper remains internally consistent.

| Metric Family | Required Metrics |
|---|---|
| latency | mean, p50, p95, and weighted mean total latency |
| throughput | requests per second |
| correctness | verification failures and success rate |
| memory | peak RSS and memory delta |
| proof cost | mean proof size, p95 proof size |

For concurrency specifically, also include:

| Additional Concurrency Metrics | Why It Matters |
|---|---|
| queueing delay | separates service time from waiting time |
| timeout rate | shows saturation behavior |
| throughput saturation point | shows practical deployment ceiling |

## 6. Curve Set to Plot

The paper should not show only tables. It should plot explicit scalability curves.

### Figure family A: Corpus-growth curves

| Figure | X-axis | Y-axis |
|---|---|---|
| A1 | corpus size | mean total latency |
| A2 | corpus size | mean verification latency |
| A3 | corpus size | mean proof size |
| A4 | corpus size | peak memory |

### Figure family B: Vocabulary-growth curves

| Figure | X-axis | Y-axis |
|---|---|---|
| B1 | vocabulary size | index build time |
| B2 | vocabulary size | mean query latency |
| B3 | vocabulary size | index storage size |
| B4 | vocabulary size | peak memory |

### Figure family C: Posting-list curves

| Figure | X-axis | Y-axis |
|---|---|---|
| C1 | posting-list size bucket | search latency |
| C2 | posting-list size bucket | verification latency |
| C3 | posting-list size bucket | proof size |

### Figure family D: Clause-count curves

| Figure | X-axis | Y-axis |
|---|---|---|
| D1 | clause count | total latency |
| D2 | clause count | verification latency |
| D3 | clause count | proof size |

### Figure family E: Concurrent-user curves

| Figure | X-axis | Y-axis |
|---|---|---|
| E1 | concurrent users | mean latency |
| E2 | concurrent users | p95 latency |
| E3 | concurrent users | throughput |
| E4 | concurrent users | success rate |

## 7. Strongest Query Families for the Curves

Not every curve needs every query family. The cleanest design is to map each scalability axis to the query families that stress it best.

| Axis | Best Query Families |
|---|---|
| corpus size | single keyword, AND-2, AND-4 |
| vocabulary size | single keyword, fuzzy_1, semantic_v1 |
| posting-list size | single keyword, OR-2, range-year |
| clause count | OR-2/4/8/16, OR-of-AND |
| concurrent users | AND-2, OR-2, range-month, semantic_v1 |

This keeps the curve set informative without exploding the number of runs.

## 8. Recommended Experimental Design

To maintain a top-journal standard, use controlled one-factor-at-a-time scaling:

1. vary one axis
2. hold all other factors fixed
3. run the same hardware and deployment mode
4. use the same trial count per point
5. report both central tendency and tail latency

Then add a smaller two-factor interaction study for the two most important pairs:

| Interaction | Why It Is Valuable |
|---|---|
| corpus size x posting-list size | separates dataset growth from result breadth |
| clause count x concurrent users | shows stress under expressive multi-user search |

## 9. Minimal Matrix vs Strong Matrix

### Minimal acceptable matrix

If time is limited, the minimum richer scalability matrix should be:

| Axis | Minimum Points |
|---|---:|
| corpus size | 4 |
| vocabulary size | 4 |
| posting-list size | 4 buckets |
| clause count | 4 |
| concurrent users | 6 |

### Strong IEEE-style matrix

If you want the strongest version, use:

| Axis | Strong Points |
|---|---:|
| corpus size | 6 |
| vocabulary size | 6 |
| posting-list size | 5 buckets |
| clause count | 5 |
| concurrent users | 7 |

## 10. Main Claims These Curves Support

This richer scalability evaluation would let the paper make stronger claims such as:

- PrivSearch remains practical as corpus size increases toward the full healthcare-scale dataset.
- Query cost depends more strongly on posting-list breadth and verification workload than on raw corpus size alone.
- Disjunctive expressiveness scales predictably with clause count.
- Authentication overhead remains bounded under realistic concurrent-user pressure.
- The system’s scalability can be decomposed into data-scale, index-scale, query-scale, and user-load dimensions.

These are much stronger than a general statement that "the benchmark ran successfully."

## 11. Recommended Output Files

The cleanest artifact layout is:

| File | Purpose |
|---|---|
| `Results/paper_assets/privsearch_scalability_corpus.csv` | corpus-size results |
| `Results/paper_assets/privsearch_scalability_vocabulary.csv` | vocabulary-size results |
| `Results/paper_assets/privsearch_scalability_postings.csv` | posting-list results |
| `Results/paper_assets/privsearch_scalability_clause_count.csv` | clause-count results |
| `Results/paper_assets/privsearch_scalability_concurrency.csv` | concurrent-user results |
| `Results/paper_assets/privsearch_scalability_summary.md` | human-readable consolidated summary |

And for figures:

| Figure File | Purpose |
|---|---|
| `figure_privsearch_scalability_corpus.svg` | corpus-growth curves |
| `figure_privsearch_scalability_vocabulary.svg` | vocabulary-growth curves |
| `figure_privsearch_scalability_postings.svg` | posting-list curves |
| `figure_privsearch_scalability_clause_count.svg` | clause-count curves |
| `figure_privsearch_scalability_concurrency.svg` | concurrent-user curves |

## 12. Manuscript-Ready Summary Sentence

If you want a short paper sentence for this stronger direction, use:

> Beyond workload-level benchmarking, we evaluate PrivSearch scalability along five controlled axes: corpus size, keyword-vocabulary size, posting-list cardinality, disjunctive clause count, and concurrent-user load, reporting latency, memory footprint, proof size, and throughput curves for each dimension.

## 13. Best Next Step

The next practical implementation step is to create a dedicated scalability benchmark driver that accepts:

- corpus slice size
- vocabulary cap
- posting-list bucket selector
- clause count
- concurrency level

and writes unified CSV outputs so the plots can be generated automatically.

## 14. Current Executable Artifact

This project now has a first executable scalability driver:

`scripts/benchmark-privsearch-scalability.js`

with package entry:

`npm run privsearch:benchmark:scalability`

It currently generates:

- `Results/paper_assets/privsearch_scalability_summary.md`
- `Results/paper_assets/privsearch_scalability_summary.json`
- `Results/paper_assets/privsearch_scalability_postings.csv`
- `Results/paper_assets/privsearch_scalability_clause_count.csv`
- `Results/paper_assets/privsearch_scalability_concurrency.csv`
- `Results/paper_assets/privsearch_scalability_corpus.csv`
- `Results/paper_assets/privsearch_scalability_vocabulary.csv`

and uses:

- `Results/paper_assets/privsearch_scalability_manifest.json`

for corpus-size and vocabulary-size slice definitions.

The current executable interpretation is intentionally careful:

1. Posting-list-size scaling is already measured directly from real `single_keyword` workloads grouped by observed `doc_freq`.
2. Clause-count scaling is already measured directly from the current executable query families supported by the PrivSearch prototype.
3. Concurrent-user scaling is already measured as same-process engine stress on representative PrivSearch queries.
4. Corpus-size and vocabulary-size scaling are manifest-driven so prepared dataset/index slices can be plugged in without changing the benchmark code.
