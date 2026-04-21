"""Carameli Locust profiles (Track D3).

Default tasks emulate key API traffic:
  - /health
  - /PhoneLine/GetCount/{customerId}
  - /VsExtension/GetAvailable/{customerId}/100/200
  - /VsMessaging/Sms/Send/{customerId}
  - /webhooks/jambonz/call-status

Environment variables:
  LOCUST_API_KEY          Bearer token used for authenticated API routes
  LOCUST_CUSTOMER_IDS     Comma-separated customer IDs (default: 1001,1002,1003)
  LOCUST_SMS_CUSTOMER_ID  Customer ID used by SMS send task (default: 1001)
  LOCUST_SMS_FROM_NUMBER  E.164 sender DID for SMS task
  LOCUST_SMS_TO_NUMBER    E.164 destination number for SMS task
"""

from __future__ import annotations

import os
import random
import uuid
from typing import ClassVar

from locust import HttpUser, LoadTestShape, between, constant, task


def _parse_customer_ids(raw: str) -> list[int]:
    customer_ids = [int(value.strip()) for value in raw.split(",") if value.strip().isdigit()]
    return customer_ids or [1001, 1002, 1003]


_API_KEY = os.getenv("LOCUST_API_KEY", os.getenv("LOAD_TEST_API_KEY", "change_me"))
_HEADERS = {"Authorization": f"Bearer {_API_KEY}"}
_CUSTOMER_IDS = _parse_customer_ids(os.getenv("LOCUST_CUSTOMER_IDS", "1001,1002,1003"))
_SMS_CUSTOMER_ID = int(os.getenv("LOCUST_SMS_CUSTOMER_ID", "1001"))
_SMS_FROM_NUMBER = os.getenv("LOCUST_SMS_FROM_NUMBER", "+11001550001")
_SMS_TO_NUMBER = os.getenv("LOCUST_SMS_TO_NUMBER", "+14155550099")


class CarameliUser(HttpUser):
    """Base user task mix for Carameli API traffic simulation."""

    abstract = True
    wait_time = between(0.5, 2.0)

    @task(5)
    def health_check(self) -> None:
        self.client.get("/health", name="/health")

    @task(3)
    def get_phone_line_count(self) -> None:
        customer_id = random.choice(_CUSTOMER_IDS)  # noqa: S311
        self.client.get(
            f"/vsapi/1.0.0/PhoneLine/GetCount/{customer_id}",
            headers=_HEADERS,
            name="/vsapi/1.0.0/PhoneLine/GetCount/{cid}",
        )

    @task(2)
    def list_extensions(self) -> None:
        customer_id = random.choice(_CUSTOMER_IDS)  # noqa: S311
        self.client.get(
            f"/vsapi/1.0.0/VsExtension/GetAvailable/{customer_id}/100/200",
            headers=_HEADERS,
            name="/vsapi/1.0.0/VsExtension/GetAvailable/{cid}/100/200",
        )

    @task(1)
    def send_sms(self) -> None:
        self.client.post(
            f"/vsapi/1.0.0/VsMessaging/Sms/Send/{_SMS_CUSTOMER_ID}",
            json={
                "from_number": _SMS_FROM_NUMBER,
                "to_number": _SMS_TO_NUMBER,
                "body": "Load test SMS",
            },
            headers=_HEADERS,
            name="/vsapi/1.0.0/VsMessaging/Sms/Send/{customerId}",
        )

    @task(1)
    def webhook_call_status(self) -> None:
        self.client.post(
            "/webhooks/jambonz/call-status",
            json={
                "call_sid": f"CAload{uuid.uuid4().hex[:8]}",
                "call_status": "completed",
                "from": "+14155550000",
                "to": "+14155550001",
                "duration": "30",
            },
            name="/webhooks/jambonz/call-status",
        )


class SustainedUser(CarameliUser):
    """Sustained load profile: 50 users, moderate think time."""

    fixed_count = int(os.getenv("LOCUST_SUSTAINED_USERS", "50"))


class StressUser(CarameliUser):
    """Stress profile: 200 users, short think time."""

    wait_time = between(0.1, 0.5)
    fixed_count = int(os.getenv("LOCUST_STRESS_USERS", "200"))


class SpikeUser(CarameliUser):
    """Spike profile: 500 users, zero think time."""

    wait_time = constant(0)
    fixed_count = int(os.getenv("LOCUST_SPIKE_USERS", "500"))


class SoakUser(CarameliUser):
    """Soak profile: 20 users, slower request cadence for long runs."""

    wait_time = between(1.0, 3.0)
    fixed_count = int(os.getenv("LOCUST_SOAK_USERS", "20"))


class SpikeShape(LoadTestShape):
    """Warm-up → spike → recovery profile."""

    stages: ClassVar[list[dict[str, int]]] = [
        {"duration": 60, "users": 10, "spawn_rate": 10},
        {"duration": 90, "users": 500, "spawn_rate": 100},
        {"duration": 120, "users": 10, "spawn_rate": 10},
    ]

    def tick(self):
        run_time = self.get_run_time()
        for stage in self.stages:
            if run_time < stage["duration"]:
                return stage["users"], stage["spawn_rate"]
        return None


class SoakShape(LoadTestShape):
    """Steady long-run profile: 20 users for 60 minutes."""

    users = int(os.getenv("LOCUST_SOAK_USERS", "20"))
    spawn_rate = int(os.getenv("LOCUST_SOAK_SPAWN_RATE", "2"))
    duration_seconds = 60 * 60

    def tick(self):
        if self.get_run_time() < self.duration_seconds:
            return self.users, self.spawn_rate
        return None
