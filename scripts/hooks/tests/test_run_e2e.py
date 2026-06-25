"""Tests for scripts/run-e2e.py pure parsing/classification helpers."""

from conftest import load_module

mod = load_module("scripts/run-e2e.py")


def test_get_fix_hint_cors():
    assert "CORS" in mod.get_fix_hint("blocked by CORS policy")


def test_get_fix_hint_5xx():
    assert "5xx" in mod.get_fix_hint("response status=503")


def test_get_fix_hint_default():
    assert "underlying application code" in mod.get_fix_hint("totally unrelated text")


def test_get_unreachable_preflight_urls_empty_when_all_reachable():
    assert mod.get_unreachable_preflight_urls(lambda _url, _timeout: True) == []


def test_get_unreachable_preflight_urls_lists_failed_endpoints():
    def fake_check(url: str, _timeout: int) -> bool:
        return url == mod.BACKEND_HEALTH

    unreachable = mod.get_unreachable_preflight_urls(fake_check)
    assert unreachable == [f"frontend dev server ({mod.VITE_URL})"]


def test_count_results():
    lines = [
        "tests/e2e/test_smoke.py::test_a[chromium] PASSED",
        "tests/e2e/test_smoke.py::test_b[chromium] FAILED",
        "tests/e2e/test_smoke.py::test_c[chromium] SKIPPED",
        "tests/e2e/test_smoke.py::test_d[chromium] ERROR",
        "some other line",
    ]
    assert mod.count_results(lines) == (1, 2, 1)


def test_is_server_down_true_for_connection_errors():
    out = "net::ERR_CONNECTION_REFUSED at page.goto"
    assert mod.is_server_down(out, fail_count=1) is True


def test_is_server_down_false_with_assertion():
    out = "net::ERR_CONNECTION_REFUSED\nAssertionError: nope"
    assert mod.is_server_down(out, fail_count=1) is False


def test_is_server_down_false_no_failures():
    assert mod.is_server_down("net::ERR_CONNECTION_REFUSED", fail_count=0) is False


def test_remove_diff_noise_keeps_assertion_and_context():
    block = [
        "tests/e2e/test_smoke.py:10: in test_x",
        "    assert page.title() == 'Home'",
        "E   AssertionError: assert 'X' == 'Home'",
        "E   + where 'X' = title()",
        "E   extra diff noise line",
    ]
    out = mod.remove_diff_noise(block)
    blob = "\n".join(out)
    assert "AssertionError" in blob
    assert "+ where" in blob
    assert "extra diff noise line" not in blob


def test_build_artifact_empty_on_pass():
    assert mod.build_artifact(["whatever"], exit_code=0, fail_count=0) == ""


def test_build_artifact_structured_block():
    lines = [
        "____ test_login[chromium] ____",
        "tests/e2e/test_login.py:5: in test_login",
        "    assert resp.status == 200",
        "E   AssertionError: assert 503 == 200",
        "=== short test summary info ===",
        "FAILED tests/e2e/test_login.py::test_login - AssertionError",
    ]
    art = mod.build_artifact(lines, exit_code=1, fail_count=1)
    assert "# test_login[chromium]" in art
    assert "# fix:" in art
    assert "# summary" in art
    assert "FAILED tests/e2e/test_login.py::test_login" in art


def test_build_artifact_collection_error_fallback():
    lines = ["ImportError: cannot import name 'x'"]
    art = mod.build_artifact(lines, exit_code=2, fail_count=0)
    assert "# e2e-collection-error" in art
    assert "ImportError" in art
