# Performance baselines

Track D3 baseline file for Locust runs.

> First-run values should be recorded from actual load test reports. Future runs should stay within +20% of these latency/error baselines.

## Workload profiles

| Profile | Users | Duration | Notes |
| --- | ---: | --- | --- |
| Sustained | 50 | 5 minutes (initial) | General steady traffic |
| Stress | 200 | 5-10 minutes | Capacity pressure |
| Spike | 500 | staged (SpikeShape) | Burst/recovery behavior |
| Soak | 20 | 60 minutes | Long-run stability |

## Endpoint/task latency baselines

| Task name | p50 (ms) | p95 (ms) | p99 (ms) | Error rate (%) | Baseline date |
| --- | ---: | ---: | ---: | ---: | --- |
| `/health` | TBD | TBD | TBD | TBD | TBD |
| `/vsapi/1.0.0/PhoneLine/GetCount/{cid}` | TBD | TBD | TBD | TBD | TBD |
| `/vsapi/1.0.0/VsExtension/GetAvailable/{cid}/100/200` | TBD | TBD | TBD | TBD | TBD |
| `/vsapi/1.0.0/VsMessaging/Sms/Send/1001` | TBD | TBD | TBD | TBD | TBD |
| `/webhooks/jambonz/call-status` | TBD | TBD | TBD | TBD | TBD |

## Regression guardrail

A future run is considered regressed if:

- p50, p95, or p99 exceeds baseline by more than 20%, or
- error rate exceeds baseline by more than 20% relative increase.

## Notes

- Capture numbers from Locust HTML report artifacts.
- Record host machine / Docker resource limits alongside each baseline update.
