"""Tests for scripts/pre-commit.py pure parsing/classification/rendering."""

from conftest import load_module

mod = load_module("scripts/pre-commit.py")


def test_parse_hook_blocks_only_failed():
    lines = [
        "detect secrets........Passed",
        "ruff..................Failed",
        "- hook id: ruff",
        "app/x.py:1:1 E501 line too long",
        "mypy.................Passed",
    ]
    hooks = mod.parse_hook_blocks(lines)
    assert list(hooks) == ["ruff"]
    assert any("E501" in line for line in hooks["ruff"])


def test_classify_hook_auto_fixed():
    assert mod.classify_hook(["files were modified by this hook"]) == "auto-fixed"


def test_classify_hook_misconfigured():
    assert mod.classify_hook(["error: unrecognized subcommand 'foo'"]) == "misconfigured"


def test_classify_hook_error():
    assert mod.classify_hook(["app/x.py:1 E501"]) == "error"


def test_build_name_to_id():
    config = (
        "repos:\n"
        "  - repo: local\n"
        "    hooks:\n"
        "      - id: ruff-format\n"
        "        name: Ruff Format\n"
        "      - id: mypy\n"
        "        name: Mypy Type Check\n"
    )
    mapping = mod.build_name_to_id(config)
    assert mapping["Ruff Format"] == "ruff-format"
    assert mapping["Mypy Type Check"] == "mypy"


def test_render_artifact_error_verbatim():
    out = mod.render_artifact({"ruff": ["app/x.py:1 E501"]}, {"ruff": "error"}, [])
    assert "## ruff [error]" in out
    assert "app/x.py:1 E501" in out


def test_render_artifact_auto_fixed_lists_files():
    out = mod.render_artifact(
        {"black": ["files were modified"]}, {"black": "auto-fixed"}, ["app/x.py"]
    )
    assert "## black [auto-fixed]" in out
    assert "app/x.py" in out
    assert "stage the modified files" in out


def test_render_artifact_misconfigured_points_to_config():
    out = mod.render_artifact({"foo": ["unknown option"]}, {"foo": "misconfigured"}, [])
    assert ".pre-commit-config.yaml" in out
    assert "`foo`" in out
