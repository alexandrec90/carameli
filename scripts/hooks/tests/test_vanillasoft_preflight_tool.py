"""Contract and smoke tests for the Windows VanillaSoft preflight tool."""

from __future__ import annotations

import json
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from conftest import REPO_ROOT

SCRIPT = REPO_ROOT / "tools" / "vanillasoft-preflight" / "carameli-preflight.ps1"


def _powershell() -> str:
    executable = shutil.which("pwsh") or shutil.which("powershell")
    if executable is None:
        pytest.skip("PowerShell is required to execute the Windows preflight smoke test")
    return executable


class _ProbeHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
        elif self.path == "/notify":
            self.send_response(405)
        else:
            self.send_response(404)
        self.end_headers()

    def log_message(self, _format, *_args):
        return


@pytest.fixture
def probe_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _ProbeHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _run_preflight(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [_powershell(), "-NoProfile", "-NonInteractive", "-File", str(SCRIPT), *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def test_preflight_script_keeps_remote_reads_data_free():
    text = SCRIPT.read_text(encoding="utf-8")

    assert "SELECT TOP (0) * FROM" in text
    assert "file contents were not emitted" in text
    assert "event contents were not emitted" in text
    assert "-MaxEvents 1 -ErrorAction Stop" in text
    assert "-Method Get" in text
    assert "-Method Post" not in text
    assert "ConvertTo-Json" in text
    assert "ZeroFreeBSTR" in text


def test_preflight_writes_pass_report_for_reachable_safe_channels(tmp_path, probe_server):
    output = tmp_path / "result.json"
    readable_log = tmp_path / "remote.log"
    readable_log.write_text("content must not appear in the report", encoding="utf-8")

    result = _run_preflight(
        "-CarameliUrl",
        probe_server,
        "-VanillaSoftNotifyUrl",
        f"{probe_server}/notify",
        "-SkipEventLog",
        "-LogPath",
        str(readable_log),
        "-OutputPath",
        str(output),
    )

    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads(output.read_text(encoding="utf-8"))
    checks = {check["name"]: check for check in report["checks"]}
    assert report["overall"] == "pass"
    assert checks["carameli-health"]["status"] == "pass"
    assert checks["vanillasoft-notify-route"]["status"] == "pass"
    assert checks["log-file-read"]["status"] == "pass"
    assert checks["sql-login"]["status"] == "not_run"
    assert "content must not appear" not in output.read_text(encoding="utf-8")


def test_preflight_writes_failure_report_when_health_is_unreachable(tmp_path):
    output = tmp_path / "failed.json"

    result = _run_preflight(
        "-CarameliUrl",
        "http://127.0.0.1:1",
        "-SkipEventLog",
        "-TimeoutSeconds",
        "1",
        "-OutputPath",
        str(output),
    )

    assert result.returncode == 1, result.stdout + result.stderr
    report = json.loads(output.read_text(encoding="utf-8"))
    checks = {check["name"]: check for check in report["checks"]}
    assert report["overall"] == "attention_required"
    assert report["counts"]["failed"] == 1
    assert checks["carameli-health"]["status"] == "fail"
