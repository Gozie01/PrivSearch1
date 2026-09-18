# Experiment EXP-4: Security Fuzzing Benchmark
Generated: 2026-07-08T05:28:40.960Z
## Summary Table
| Experiment | N | Detection / Rejection Rate | 95% CI | Mean Time (ms) | P95 Time (ms) |
|---|---:|---:|---|---:|---:|
| EXP-4.1a blockHash tamper | 1000 | 100.00% | [99.62%, 100.00%] | 0.6975 | 1.2981 |
| EXP-4.1a merkleRoot tamper | 1000 | 100.00% | [99.62%, 100.00%] | 0.7198 | 1.2758 |
| EXP-4.1a index tamper | 1000 | 100.00% | [99.62%, 100.00%] | 0.6470 | 1.1839 |
| EXP-4.1b MongoDB contentHash tamper | 500 | 100.00% | [99.24%, 100.00%] | 2.2135 | 2.9207 |
| EXP-4.2 Replay attack rejection | 0 | 0.00% | [0.00%, 0.00%] | 0.0000 | 0.0000 |
| EXP-4.4 Valid Merkle proofs | 1000 | 100.00% | [99.62%, 100.00%] | 0.0050 | 0.0095 |
| EXP-4.4 Corrupted proof rejection | 1000 | 100.00% | [99.62%, 100.00%] | 0.0050 | 0.0090 |
## EXP-4.1a: Audit Chain Tampering
Chain blocks: 2740 | Trials per sub-experiment: 1000

| Sub-experiment | Detections | Rate | 95% CI |
|---|---:|---:|---|
| blockHash corruption | 1000 | 100.00% | [99.62%, 100.00%] |
| merkleRoot field tamper | 1000 | 100.00% | [99.62%, 100.00%] |
| index field tamper | 1000 | 100.00% | [99.62%, 100.00%] |
## EXP-4.1b: MongoDB Record Tampering
N=500 | Detections: 500 | Rate: 100.00%  
95% CI: [99.24%, 100.00%]  
Mean detection time: 2.2135 ms | P95: 2.9207 ms
## EXP-4.2: Replay Attack Detection
N=0 | Rejections: 0 | Rate: 0.00%  
95% CI: [0.00%, 0.00%]  
Mean rejection time: 0.0000 ms | P95: 0.0000 ms
## EXP-4.4: Merkle Proof Verification at Scale
Trees: 100 | Proofs per tree: 10

| Type | N | Rate | 95% CI | Mean ms | P95 ms |
|---|---:|---:|---|---:|---:|
| Valid proofs (should pass) | 1000 | 100.00% | [99.62%, 100.00%] | 0.0050 | 0.0095 |
| Corrupted proofs (should reject) | 1000 | 100.00% | [99.62%, 100.00%] | 0.0050 | 0.0090 |