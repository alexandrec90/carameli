"""Tests for `scripts/phone-countries.py` -- the pure half, which is all of the logic.

Everything that decides an answer is a function over data: the calling-code index, the
longest-prefix match, the list read out of the frontend module, the tally and the report.
`fetch_numbers` is the only part that needs a database and it holds one query.

The privacy property is asserted here rather than left to the docstring: `report_lines`
takes counts, so no number can reach the output even if the caller has them.
"""

from __future__ import annotations

import importlib.util
from collections import Counter
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "phone-countries.py"


def load_module():
    """Import the hyphenated script by path; it is not a package member."""
    spec = importlib.util.spec_from_file_location("phone_countries", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mod = load_module()

METADATA = {
    "country_calling_codes": {
        "1": ["US", "CA", "AG"],
        "1242": ["BS"],
        "44": ["GB", "JE"],
        "234": ["NG"],
        "999": [],
    }
}


@pytest.fixture
def index():
    return mod.calling_code_index(METADATA)


def test_index_takes_the_principal_country_for_a_shared_code(index):
    # `1` is the whole NANP; the metadata lists the principal one first and that is the
    # attribution the parser makes for an ambiguous number.
    assert index["1"] == "US"
    assert index["44"] == "GB"


def test_index_skips_a_calling_code_with_no_countries(index):
    assert "999" not in index


def test_longest_calling_code_wins(index):
    # The failure this ordering exists for: `1` would otherwise claim every Bahamian
    # number, and the report would say the Bahamas has no traffic.
    assert mod.country_of("+12425551234", index) == "BS"
    assert mod.country_of("+12135551234", index) == "US"


def test_reads_an_ordinary_international_number(index):
    assert mod.country_of("+2348031234567", index) == "NG"
    assert mod.country_of("  +44 20 7183 8750  ", index) == "GB"


def test_skips_what_is_not_written_internationally(index):
    # A national number means nothing without already knowing the plan, which is the
    # question being asked -- so it is skipped rather than guessed at.
    assert mod.country_of("08031234567", index) is None
    assert mod.country_of("", index) is None
    assert mod.country_of("extension 101", index) is None


def test_skips_a_calling_code_nothing_claims(index):
    assert mod.country_of("+9995551234", index) is None


def test_reads_the_country_list_out_of_the_frontend_module():
    source = """
    export const FORMATTED_COUNTRIES: readonly string[] = [
      // Named as the service's own regions.
      'US', 'CA', 'GB',
      'PT',
    ]
    """
    assert mod.formatted_countries(source) == ["US", "CA", "GB", "PT"]


def test_reads_an_empty_list_when_the_constant_is_gone():
    # Better an empty answer than a crash: the script's job is to report, and a renamed
    # constant should show as "nothing is formatted" rather than as a traceback.
    assert mod.formatted_countries("export const SOMETHING_ELSE = ['US']") == []


def test_the_real_frontend_module_parses():
    # Guards the regex against the file it actually reads: a reformat that broke the
    # shape would otherwise make every plan look uncarried.
    source = (REPO_ROOT / "frontend" / "phoneMetadata.ts").read_text(encoding="utf-8")
    carried = mod.formatted_countries(source)
    assert len(carried) > 20
    assert "US" in carried and "GB" in carried


def test_tally_counts_plans_and_ignores_the_unattributable(index):
    counts = mod.tally(["+12135551234", "+12135559999", "+2348031234567", "0803"], index)
    assert counts == Counter({"US": 2, "NG": 1})


def test_report_names_a_plan_in_use_that_is_not_formatted():
    lines, missing = mod.report_lines(Counter({"US": 10, "NG": 4}), ["US"], min_count=1)
    assert missing == ["NG"]
    assert any("TRIMMED" in line and "NG" in line for line in lines)
    assert any("gen:phone-metadata" in line for line in lines)


def test_min_count_keeps_the_long_tail_out_of_the_missing_list():
    _, missing = mod.report_lines(Counter({"US": 500, "NG": 2}), ["US"], min_count=25)
    assert missing == []


def test_report_names_formatted_plans_nothing_uses():
    # The other direction, and the one that shrinks the table: a plan carried for nobody
    # is 0.33 KB every visitor downloads for no reason.
    lines, _ = mod.report_lines(Counter({"US": 10}), ["US", "PT"], min_count=1)
    assert any("formatted but unused (1): PT" in line for line in lines)


def test_no_phone_number_survives_the_aggregation(index):
    # The privacy property, asserted rather than left to the docstring. The numbers go in
    # at `tally`; what comes out is a histogram keyed by country, and `report_lines` never
    # sees anything else -- so a number cannot reach a terminal or a CI log by any route
    # through this script.
    numbers = ["+12135559999", "+2348031234567", "+441534888888"]
    lines, _ = mod.report_lines(mod.tally(numbers, index), ["US"], min_count=1)
    printed = "\n".join(lines)
    for number in numbers:
        assert number not in printed
        assert number.lstrip("+")[3:] not in printed


def test_database_url_is_translated_into_psycopgs_spelling(monkeypatch):
    # The app's `DATABASE_URL` names the asyncpg driver, which psycopg cannot open.
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@localhost:5432/carameli")
    assert mod.database_url() == "postgresql://u:p@localhost:5432/carameli"


def test_main_refuses_without_a_database_rather_than_reporting_nothing(monkeypatch, capsys):
    # An empty report from a missing database reads exactly like an empty report from an
    # empty one, and the two call for opposite responses.
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setattr(mod, "REPO_ROOT", Path("/nonexistent"))
    assert mod.main([]) == 2
    assert "DATABASE_URL" in capsys.readouterr().err


def test_extensions_are_not_read_as_numbers():
    # An extension is an internal label; folding the column in would report a numbering
    # plan for '101'.
    assert "extension" not in mod.NUMBER_COLUMNS["call_events"]


class FakeCursor:
    """Records what was executed and hands back one row per query."""

    def __init__(self, queries: list[object]) -> None:
        self.queries = queries

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, query):
        self.queries.append(query)

    def fetchall(self):
        return [("+12135551234",)]


class FakeConnection:
    def __init__(self, queries: list[object]) -> None:
        self.queries = queries

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self):
        return FakeCursor(self.queries)


@pytest.fixture
def fake_psycopg(monkeypatch):
    """Stand in for the driver, which `fetch_numbers` imports when it is called.

    The late import is what makes this possible without psycopg installed, and is why it
    is late: every pure function above has to be testable on a machine with no driver.
    """
    import sys
    import types

    queries: list[object] = []

    class Identifier:
        def __init__(self, name: str) -> None:
            self.name = name

        def __repr__(self) -> str:
            return f'"{self.name}"'

    class Composed(str):
        pass

    class SQL:
        def __init__(self, template: str) -> None:
            self.template = template

        def format(self, **kwargs) -> Composed:
            return Composed(self.template.format(**kwargs))

    # Attributes go in through the module namespace: a `ModuleType` has no typed
    # attributes, so assigning them by name would need a type-checker suppression each.
    sql = types.ModuleType("psycopg.sql")
    vars(sql).update({"SQL": SQL, "Identifier": Identifier})
    psycopg = types.ModuleType("psycopg")
    vars(psycopg).update({"connect": lambda url: FakeConnection(queries), "sql": sql})
    monkeypatch.setitem(sys.modules, "psycopg", psycopg)
    monkeypatch.setitem(sys.modules, "psycopg.sql", sql)
    return queries


def test_fetch_numbers_reads_every_column_that_holds_one(fake_psycopg):
    numbers = mod.fetch_numbers("postgresql://localhost/x")
    expected = sum(len(cols) for cols in mod.NUMBER_COLUMNS.values())
    assert len(fake_psycopg) == expected
    assert numbers == ["+12135551234"] * expected


def test_fetch_numbers_composes_identifiers_rather_than_interpolating(fake_psycopg):
    # The reason the query carries no S608 suppression: the table and column names go in
    # as identifiers, so the rule has nothing to say and no reader has to check.
    mod.fetch_numbers("postgresql://localhost/x")
    rendered = [str(q) for q in fake_psycopg]
    assert any('"phone_lines"' in q and '"phone_number"' in q for q in rendered)
    assert all("IS NOT NULL" in q for q in rendered)
