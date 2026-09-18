# PrivSearch Replay Protection Benchmark

Generated: 2026-09-11T06:36:59.975Z

Trials: 200

| Metric | Value |
|---|---:|
| Accepted first requests | 200 |
| Replayed requests rejected | 200 |
| Header/setup failures | 0 |
| Replay rejection rate | 100.00% |
| Mean accepted latency (ms) | 581.4113 |
| P95 accepted latency (ms) | 1344.0804 |
| Mean replay rejection latency (ms) | 0.7897 |
| P95 replay rejection latency (ms) | 1.1734 |

Replay status snapshot:

```json
{
  "mode": "required",
  "ttlMs": 300000,
  "allowedSkewMs": 300000,
  "cacheSize": 200,
  "totalAccepted": 200,
  "totalRejected": 200,
  "totalOptionalBypasses": 0
}
```