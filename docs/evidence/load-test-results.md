# Load Test Results

> **Status:** Pending — run `tests/load/locustfile.py` against a staging environment
> and fill in the table below.

## How to run

```bash
pip install locust

# Set env vars
export LOAD_TEST_API_KEY=<your-api-key>
export LOAD_TEST_FROM_DID=+12025550100
export LOAD_TEST_TO_DID=+12025550199
export LOAD_TEST_AUDIO_URL=https://your-bucket/voicemail.mp3

# Headless run (50 users, 5/s ramp, 60s)
locust -f tests/load/locustfile.py --host http://<staging-host>:8000 \
       --users 50 --spawn-rate 5 --run-time 60s --headless \
       --csv artifacts/load-tests/load-test-results

# Or open the web UI for interactive runs:
locust -f tests/load/locustfile.py --host http://<staging-host>:8000
```

## Results — [DATE TBD]

### Environment

| Item | Value |
|------|-------|
| Host | TBD |
| Users | TBD |
| Spawn rate | TBD |
| Duration | TBD |
| Jambonz version | TBD |
| FreeSWITCH version | TBD |

### Throughput

| Scenario | Requests | RPS | Median (ms) | p95 (ms) | p99 (ms) | Failures |
|----------|----------|-----|-------------|----------|----------|----------|
| Voicemail drop (outbound calls) | — | — | — | — | — | — |
| Inbound call webhook | — | — | — | — | — | — |
| SMS send | — | — | — | — | — | — |

### Pass criteria

- p95 latency < 500 ms on SMS send
- p95 latency < 2000 ms on outbound call initiation
- Error rate < 1% across all scenarios
- No OOM kills or process restarts during the run

### Notes

_Fill in observations after running the test._
