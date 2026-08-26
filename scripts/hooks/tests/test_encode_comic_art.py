"""Tests for scripts/encode-comic-art.py.

The encoder invocation gets a test of its own because prose could not hold it: the
`sharp-cli` line in `frontend/assets-src/comic-book/README.md` was that tool's pre-6
spelling for long enough that following it wrote nothing and exited with `Unknown
argument: webp`. A pinned argv fails a suite instead.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[2]


def _load():
    spec = importlib.util.spec_from_file_location(
        "encode_comic_art", SCRIPTS / "encode-comic-art.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


eca = _load()


class TestNodeArgv:
    def test_passes_input_output_edge_and_quality_in_that_order(self):
        argv = eca.node_argv(Path("/m/switchboard.png"), Path("/p/switchboard.webp"), 1408, 82)

        assert argv[0] == "node"
        assert argv[1] == "-e"
        assert argv[3:] == [
            str(Path("/m/switchboard.png")),
            str(Path("/p/switchboard.webp")),
            "1408",
            "82",
        ]

    def test_does_not_reach_for_sharp_cli(self):
        # sharp-cli is not a dependency, so every call was an `npx --yes` network
        # fetch -- and the spelling the README carried failed outright anyway.
        argv = eca.node_argv(Path("a.png"), Path("a.webp"), 1408, 82)
        assert "npx" not in argv
        assert "sharp-cli" not in argv

    def test_the_program_bounds_the_long_edge_without_upscaling(self):
        # A portrait master bounded by width alone comes out taller than its own
        # master and over MAX_CONTENT_IMAGE_EDGE.
        assert "fit: 'inside'" in eca.NODE_PROGRAM
        assert "withoutEnlargement: true" in eca.NODE_PROGRAM
        assert "require('sharp')" in eca.NODE_PROGRAM


class TestDeriveLabel:
    @pytest.mark.parametrize(
        ("stem", "expected"),
        [
            ("hand-notepad", "Hand notepad"),
            ("conversation", "Conversation"),
            ("man_woman_talking", "Man woman talking"),
            ("rotary phone", "Rotary phone"),
            ("push-button-phone", "Push button phone"),
        ],
    )
    def test_reads_as_a_dropdown_entry(self, stem, expected):
        assert eca.derive_label(stem) == expected

    def test_refuses_a_stem_with_no_words(self):
        with pytest.raises(eca.EncodeError):
            eca.derive_label("---")


class TestServedUrl:
    def test_is_rooted_at_the_served_directory(self):
        assert eca.served_url("conversation.webp") == "/comic-book/conversation.webp"

    def test_percent_encodes_a_space(self):
        # `rotary phone.webp` is already in the served tree; an `<img src>` needs the
        # encoded spelling, and assetPolicy.ts decodes before comparing.
        assert eca.served_url("rotary phone.webp") == "/comic-book/rotary%20phone.webp"


class TestResolveMaster:
    @pytest.fixture
    def masters(self, tmp_path):
        (tmp_path / "conversation.png").write_bytes(b"x")
        (tmp_path / "photo.jpg").write_bytes(b"x")
        return tmp_path

    def test_finds_a_bare_name(self, masters):
        assert eca.resolve_master("conversation", masters).stem == "conversation"

    def test_finds_a_name_with_its_extension(self, masters):
        master = eca.resolve_master("conversation.png", masters)
        assert master.path == masters / "conversation.png"
        assert master.export_name == "conversation.webp"

    def test_finds_a_jpg(self, masters):
        assert eca.resolve_master("photo", masters).export_name == "photo.webp"

    def test_refuses_a_path(self, masters):
        with pytest.raises(eca.EncodeError, match="looks like a path"):
            eca.resolve_master("../elsewhere/art.png", masters)

    def test_names_the_directory_when_the_master_is_absent(self, masters):
        with pytest.raises(eca.EncodeError, match="lossless original"):
            eca.resolve_master("missing", masters)


MANIFEST = """\
export interface PanelAsset {
  src: string
  label: string
}

export const PANEL_ASSETS: PanelAsset[] = [
  { src: '/comic-book/switchboard.webp', label: 'Switchboard' },
]
"""


class TestRegisterInManifest:
    def test_appends_inside_the_array(self):
        out, changed = eca.register_in_manifest(
            MANIFEST, "/comic-book/conversation.webp", "Two agents talking"
        )
        assert changed
        assert "  { src: '/comic-book/conversation.webp', label: 'Two agents talking' },\n]" in out
        assert "switchboard" in out

    def test_is_idempotent_on_src(self):
        once, _ = eca.register_in_manifest(MANIFEST, "/comic-book/a.webp", "A")
        twice, changed = eca.register_in_manifest(once, "/comic-book/a.webp", "A")
        assert twice == once
        assert not changed

    def test_leaves_an_existing_label_alone(self):
        # Renaming a label somebody chose is not this script's call, and a second
        # line for the same src would fail assetPolicy.test.ts's duplicate check.
        once, _ = eca.register_in_manifest(MANIFEST, "/comic-book/a.webp", "Chosen name")
        again, changed = eca.register_in_manifest(once, "/comic-book/a.webp", "A")
        assert not changed
        assert again.count("/comic-book/a.webp") == 1
        assert "Chosen name" in again

    def test_refuses_a_label_that_would_break_the_quoting(self):
        with pytest.raises(eca.EncodeError, match="quote"):
            eca.register_in_manifest(MANIFEST, "/comic-book/a.webp", "Alex's phone")

    def test_reports_a_renamed_array(self):
        with pytest.raises(eca.EncodeError, match="PANEL_ASSETS"):
            eca.register_in_manifest("export const OTHER = []", "/a.webp", "A")


class TestReadMaxPublicBytes:
    def test_parses_the_underscored_literal(self):
        source = "export const MAX_PUBLIC_BYTES = 3_850 * 1024\n"
        assert eca.read_max_public_bytes(source) == 3850 * 1024

    def test_reports_a_renamed_constant(self):
        with pytest.raises(eca.EncodeError, match="MAX_PUBLIC_BYTES"):
            eca.read_max_public_bytes("export const SOMETHING_ELSE = 1 * 1024")

    def test_tracks_the_real_constant(self):
        # The point of parsing rather than duplicating: this fails if assetPolicy.ts
        # drops or renames the constant, instead of the script reporting a stale cap.
        source = eca.ASSET_POLICY.read_text(encoding="utf-8")
        assert eca.read_max_public_bytes(source) > 0


class TestBudgetReport:
    def test_under_budget_reports_the_headroom(self):
        text, over = eca.budget_report(3_000 * 1024, 3_850 * 1024)
        assert not over
        assert "spare" in text

    def test_over_budget_names_the_test_that_will_fail(self):
        text, over = eca.budget_report(4_000 * 1024, 3_850 * 1024)
        assert over
        assert "assetPolicy.test.ts" in text
        assert "OVER" in text

    def test_over_budget_suggests_a_cap_above_the_current_total(self):
        total = 4_000 * 1024 + 1
        text, _ = eca.budget_report(total, 3_850 * 1024)
        suggested = int(text.split("MAX_PUBLIC_BYTES = ")[1].split(" *")[0].replace("_", ""))
        assert suggested * 1024 > total


class TestPublicTreeBytes:
    def test_counts_every_file_below_the_directory(self, tmp_path):
        (tmp_path / "a.webp").write_bytes(b"x" * 10)
        nested = tmp_path / "comic-book"
        nested.mkdir()
        (nested / "b.webp").write_bytes(b"y" * 5)
        assert eca.public_tree_bytes(tmp_path) == 15


class TestArgumentValidation:
    def _args(self, **over):
        base = dict(
            names=["conversation"],
            max_edge=1408,
            quality=82,
            label=None,
            no_register=False,
            force=False,
        )
        base.update(over)
        return argparse.Namespace(**base)

    def test_label_with_several_masters_is_refused(self):
        with pytest.raises(eca.EncodeError, match="single MASTER"):
            eca.run(self._args(names=["a", "b"], label="One name"))

    def test_quality_out_of_range_is_refused(self):
        with pytest.raises(eca.EncodeError, match="--quality"):
            eca.run(self._args(quality=0))

    def test_non_positive_max_edge_is_refused(self):
        with pytest.raises(eca.EncodeError, match="--max-edge"):
            eca.run(self._args(max_edge=0))

    def test_parser_accepts_several_masters(self):
        args = eca.build_parser().parse_args(["conversation", "hand-notepad"])
        assert args.names == ["conversation", "hand-notepad"]
        assert args.max_edge == eca.DEFAULT_MAX_EDGE
        assert args.quality == eca.DEFAULT_QUALITY


class TestMain:
    def test_failure_writes_the_artifact_and_exits_nonzero(self, monkeypatch, tmp_path, capsys):
        monkeypatch.setattr(eca, "LOG_DIR", tmp_path)
        code = eca.main(["definitely-not-a-master-here"])
        assert code == 1
        artifact = (tmp_path / eca.ARTIFACT).read_text(encoding="utf-8")
        assert "definitely-not-a-master-here" in artifact
        assert "definitely-not-a-master-here" in capsys.readouterr().err

    def test_success_empties_a_stale_artifact(self, monkeypatch, tmp_path, capsys):
        monkeypatch.setattr(eca, "LOG_DIR", tmp_path)
        (tmp_path / eca.ARTIFACT).write_text("an older failure", encoding="utf-8")
        monkeypatch.setattr(eca, "run", lambda args: "OK    a.webp  1.0 KB")

        assert eca.main(["conversation"]) == 0
        assert (tmp_path / eca.ARTIFACT).read_text(encoding="utf-8") == ""
        assert "OK" in capsys.readouterr().out


class TestEncode:
    def test_reports_a_missing_node_rather_than_a_traceback(self, monkeypatch, tmp_path):
        monkeypatch.setattr(eca.shutil, "which", lambda _: None)
        with pytest.raises(eca.EncodeError, match="node is not on PATH"):
            eca.encode(eca.Master(tmp_path / "a.png", "a"), tmp_path / "a.webp", 1408, 82)

    def test_reports_a_missing_sharp_with_the_install_command(self, monkeypatch, tmp_path):
        monkeypatch.setattr(eca.shutil, "which", lambda _: "node")
        monkeypatch.setattr(eca, "FRONTEND", tmp_path)
        with pytest.raises(eca.EncodeError, match="npm --prefix frontend ci"):
            eca.encode(eca.Master(tmp_path / "a.png", "a"), tmp_path / "a.webp", 1408, 82)

    def _stub_sharp(self, monkeypatch, tmp_path, result):
        monkeypatch.setattr(eca.shutil, "which", lambda _: "node")
        (tmp_path / "node_modules" / "sharp").mkdir(parents=True, exist_ok=True)
        monkeypatch.setattr(eca, "FRONTEND", tmp_path)
        monkeypatch.setattr(eca.subprocess, "run", lambda *a, **k: result)

    def test_failure_carries_sharps_own_message(self, monkeypatch, tmp_path):
        class Result:
            returncode = 1
            stdout = ""
            stderr = "Input file is missing"

        self._stub_sharp(monkeypatch, tmp_path, Result())
        with pytest.raises(eca.EncodeError) as excinfo:
            eca.encode(eca.Master(tmp_path / "a.png", "a"), tmp_path / "a.webp", 1408, 82)
        assert "Input file is missing" in str(excinfo.value)

    def test_returns_the_exported_dimensions(self, monkeypatch, tmp_path):
        class Result:
            returncode = 0
            stdout = '{"width":939,"height":1408}\n'
            stderr = ""

        self._stub_sharp(monkeypatch, tmp_path, Result())
        assert eca.encode(eca.Master(tmp_path / "a.png", "a"), tmp_path / "a.webp", 1408, 82) == (
            939,
            1408,
        )

    def test_unreadable_report_is_an_error_not_a_crash(self, monkeypatch, tmp_path):
        class Result:
            returncode = 0
            stdout = "not json"
            stderr = ""

        self._stub_sharp(monkeypatch, tmp_path, Result())
        with pytest.raises(eca.EncodeError, match="unreadable"):
            eca.encode(eca.Master(tmp_path / "a.png", "a"), tmp_path / "a.webp", 1408, 82)


@pytest.mark.skipif(
    not (eca.FRONTEND / "node_modules" / "sharp").is_dir(),
    reason="frontend/node_modules/sharp is not installed in this environment",
)
class TestEncodeForReal:
    """The one test that proves the encoder call works, rather than that it is shaped
    right. Everything above pins argv; only this notices sharp changing its API."""

    def test_bounds_a_portrait_master_by_its_height(self, tmp_path):
        master = eca.MASTERS_DIR / "hand-notepad.png"
        if not master.is_file():
            pytest.skip(f"{master.name} is not in this checkout")

        export = tmp_path / "hand-notepad.webp"
        width, height = eca.encode(eca.Master(master, "hand-notepad"), export, 512, 82)

        assert max(width, height) == 512, "the long edge should be the bounded one"
        assert width < height, "a portrait master should stay portrait"
        assert export.stat().st_size > 0

    def test_does_not_upscale_past_the_master(self, tmp_path):
        master = eca.MASTERS_DIR / "hand-notepad.png"
        if not master.is_file():
            pytest.skip(f"{master.name} is not in this checkout")

        export = tmp_path / "hand-notepad.webp"
        _, height = eca.encode(eca.Master(master, "hand-notepad"), export, 99_999, 82)
        assert height < 99_999


class TestPaths:
    def test_the_directories_it_names_exist(self):
        # A silently-wrong path here is a script that encodes into nowhere.
        assert eca.MASTERS_DIR.is_dir()
        assert eca.EXPORT_DIR.is_dir()
        assert eca.MANIFEST.is_file()
        assert eca.ASSET_POLICY.is_file()
