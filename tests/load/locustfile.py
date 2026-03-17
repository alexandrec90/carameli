"""
Carameli load test — Track F

Scenarios:
  1. Outbound calls (voicemail drop pattern) — ConcurrentCallUser
  2. Inbound call routing (SIP → extension) — InboundCallUser
  3. SMS send throughput — SmsUser

Run:
  pip install locust
  locust -f tests/load/locustfile.py --host http://localhost:8000 \
         --users 50 --spawn-rate 5 --run-time 60s --headless

Or open the Locust web UI:
  locust -f tests/load/locustfile.py --host http://localhost:8000

Environment variables used by the test:
  LOAD_TEST_API_KEY   — Bearer token (matches API_KEY_SECRET in .env)
  LOAD_TEST_FROM_DID  — E.164 caller ID, e.g. +12025550100
  LOAD_TEST_TO_DID    — E.164 destination, e.g. +12025550199
  LOAD_TEST_AUDIO_URL — Public URL to an audio file for voicemail drop
"""

from __future__ import annotations

import os

from locust import HttpUser, between, task

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_API_KEY = os.getenv("LOAD_TEST_API_KEY", "change_me_to_a_long_random_string")
_FROM_DID = os.getenv("LOAD_TEST_FROM_DID", "+12025550100")
_TO_DID = os.getenv("LOAD_TEST_TO_DID", "+12025550199")
_AUDIO_URL = os.getenv(
    "LOAD_TEST_AUDIO_URL",
    "https://www2.cs.uic.edu/~i101/SoundFiles/StarWars3.wav",
)

_HEADERS = {"Authorization": f"Bearer {_API_KEY}"}


# ---------------------------------------------------------------------------
# Scenario 1 — Concurrent outbound calls (voicemail drop pattern)
# ---------------------------------------------------------------------------


class ConcurrentCallUser(HttpUser):
    """Simulates agents triggering voicemail drops concurrently."""

    weight = 3  # relative weight vs other user classes
    wait_time = between(0.5, 2.0)

    @task
    def voicemail_drop(self) -> None:
        payload = {
            "to": _TO_DID,
            "from": _FROM_DID,
            "audio_url": _AUDIO_URL,
        }
        with self.client.post(
            "/vsapi/1.0.0/VsMessageDrop",
            json=payload,
            headers=_HEADERS,
            catch_response=True,
            name="POST /VsMessageDrop",
        ) as resp:
            if resp.status_code in (200, 201, 202):
                resp.success()
            else:
                resp.failure(f"Unexpected status {resp.status_code}: {resp.text[:200]}")


# ---------------------------------------------------------------------------
# Scenario 2 — Inbound call routing (SIP → extension lookup)
# ---------------------------------------------------------------------------


class InboundCallUser(HttpUser):
    """Simulates the webhook Jambonz fires when an inbound call arrives.

    The call-status webhook is the production inbound path — we POST a
    synthetic Jambonz call-status event and measure throughput + latency.
    """

    weight = 2
    wait_time = between(0.2, 1.0)

    @task
    def call_status_webhook(self) -> None:
        payload = {
            "call_sid": "load-test-sid-inbound",
            "direction": "inbound",
            "from": _FROM_DID,
            "to": _TO_DID,
            "call_status": "completed",
            "duration": "30",
            "recording_url": "",
        }
        with self.client.post(
            "/webhooks/jambonz/call-status",
            json=payload,
            headers=_HEADERS,
            catch_response=True,
            name="POST /webhooks/jambonz/call-status (inbound)",
        ) as resp:
            # 200 or 204 are both valid acks
            if resp.status_code in (200, 204):
                resp.success()
            else:
                resp.failure(f"Unexpected status {resp.status_code}: {resp.text[:200]}")


# ---------------------------------------------------------------------------
# Scenario 3 — SMS send throughput
# ---------------------------------------------------------------------------


class SmsUser(HttpUser):
    """Simulates bulk SMS sends (e.g. appointment reminders or follow-ups)."""

    weight = 1
    wait_time = between(0.1, 0.5)

    @task
    def send_sms(self) -> None:
        payload = {
            "to": _TO_DID,
            "from": _FROM_DID,
            "body": "Load test message — please ignore.",
        }
        with self.client.post(
            "/vsapi/1.0.0/VsMessaging/Sms/Send",
            json=payload,
            headers=_HEADERS,
            catch_response=True,
            name="POST /VsMessaging/Sms/Send",
        ) as resp:
            if resp.status_code in (200, 201, 202):
                resp.success()
            else:
                resp.failure(f"Unexpected status {resp.status_code}: {resp.text[:200]}")
