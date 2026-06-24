"""Tests for scripts/run-load.py argv construction."""
from conftest import load_module

mod = load_module("scripts/run-load.py")


def test_build_argv_includes_all_flags():
    argv = mod.build_argv(50, "5", "2m", "http://localhost:9000")
    assert argv[0].endswith("locust") or argv[0].endswith("locust.exe")
    assert "-u" in argv and argv[argv.index("-u") + 1] == "50"
    assert "-r" in argv and argv[argv.index("-r") + 1] == "5"
    assert "--run-time" in argv and argv[argv.index("--run-time") + 1] == "2m"
    assert "--host" in argv and argv[argv.index("--host") + 1] == "http://localhost:9000"
    assert "--headless" in argv
    assert "tests/load/locustfile.py" in argv
