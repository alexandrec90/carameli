"""Tests for scripts/node_pin.py -- the npm `engines.node` range parser.

This module is the one that can be wrong quietly. Everything built on it asks a yes/no
question, and a parser that leaned towards "yes" would make both callers vacuous: the
PR-gate test would stop catching a pin below the tree's floor, and `check-node-pin.py`
would propose a Node the tree cannot run on. So the forms are pinned here individually,
including the ones the current lockfile happens not to contain -- the next dependency
bump is free to introduce them, and finding out then is finding out from a broken lint.
"""

from conftest import load_module

node_pin = load_module("scripts/node_pin.py")


def line(major):
    return node_pin.line(major)


# --- version parsing --------------------------------------------------------


def test_parse_version_reads_every_spelling_a_lock_uses():
    assert node_pin.parse_version("24") == (24, 0, 0)
    assert node_pin.parse_version("22.18") == (22, 18, 0)
    assert node_pin.parse_version("22.18.1") == (22, 18, 1)
    assert node_pin.parse_version("v12.22.7") == (12, 22, 7)
    assert node_pin.parse_version(" 0.4 ") == (0, 4, 0)


def test_parse_version_ignores_a_prerelease_tail():
    """`>=18.0.0-beta.1` appears in the wild. The tail decides nothing about which
    release line runs, and letting it raise would take out the whole check."""
    assert node_pin.parse_version("18.0.0-beta.1") == (18, 0, 0)


def test_a_line_is_tested_as_its_newest_possible_patch():
    major, minor, patch = line(24)
    assert major == 24
    assert minor == patch == node_pin.LINE_END


# --- ranges -----------------------------------------------------------------


def test_a_floor_is_the_common_case():
    assert node_pin.satisfies(line(24), ">=22.18.0")
    assert not node_pin.satisfies(line(20), ">=22.18.0")
    assert node_pin.satisfies(line(24), ">= 0.4")
    assert node_pin.satisfies(line(24), ">=v12.22.7")


def test_alternatives_pass_when_any_one_does():
    assert node_pin.satisfies(line(20), "^20.19.0 || >=22.12.0")
    assert node_pin.satisfies(line(24), "^22.22.2 || ^24.15.0 || >=26.0.0")
    assert not node_pin.satisfies(line(23), "^22.22.2 || ^24.15.0 || >=26.0.0")


def test_a_bare_major_is_that_release_line():
    assert node_pin.satisfies(line(24), "18 || 20 || >=22")
    assert not node_pin.satisfies(line(21), "18 || 20 || >=22")
    assert node_pin.satisfies(line(20), "20")


def test_an_upper_bound_excludes_a_newer_line():
    """The direction that protects against upgrading into a break, rather than against
    lagging behind one. No package in the lock names one today; one will."""
    assert not node_pin.satisfies(line(24), "<24.0.0")
    assert not node_pin.satisfies(line(26), ">=22.18.0 <26.0.0")
    assert node_pin.satisfies(line(24), ">=22.18.0 <26.0.0")
    assert not node_pin.satisfies(line(24), "^20.9.0")


def test_a_wildcard_admits_anything():
    assert node_pin.satisfies(line(24), "*")
    assert node_pin.satisfies(line(4), "*")


def test_caret_and_tilde_ceilings():
    assert node_pin.upper_bound("24", caret=True) == (25, 0, 0)
    assert node_pin.upper_bound("24", caret=False) == (25, 0, 0)
    assert node_pin.upper_bound("24.3", caret=False) == (24, 4, 0)
    # Below 1.0.0 each place is breaking, and npm's rule differs per arity.
    assert node_pin.upper_bound("0", caret=True) == (1, 0, 0)
    assert node_pin.upper_bound("0.2", caret=True) == (0, 3, 0)
    assert node_pin.upper_bound("0.2.3", caret=True) == (0, 3, 0)
    assert node_pin.upper_bound("0.0.3", caret=True) == (0, 0, 4)


def test_an_unparseable_range_is_not_silently_satisfied():
    """Better to report a package we cannot judge than to wave it through: the whole
    value of the check is that "no findings" means something."""
    assert not node_pin.satisfies(line(24), "")
    assert not node_pin.satisfies(line(24), "latest")


# --- against the lock -------------------------------------------------------


def test_unsatisfied_names_the_packages_rather_than_just_refusing():
    constraints = [("a", ">=22.18.0"), ("b", ">=18"), ("c", "^22.13.0 || >=24.0.0")]

    assert node_pin.unsatisfied(24, constraints) == {}
    assert node_pin.unsatisfied(20, constraints) == {
        "a": ">=22.18.0",
        "c": "^22.13.0 || >=24.0.0",
    }
    assert node_pin.unsatisfied(23, constraints) == {"c": "^22.13.0 || >=24.0.0"}


def test_unsatisfied_is_empty_for_an_empty_tree():
    assert node_pin.unsatisfied(24, []) == {}


def test_the_real_lock_is_readable_and_admits_the_real_pin():
    """The reversion check for the whole exercise: the committed pin clears the
    committed lock, and putting the pin back on 20 does not."""
    constraints = node_pin.engine_constraints()
    assert constraints, "no engines.node found -- the lock is not being read"

    assert node_pin.unsatisfied(node_pin.pinned_major(), constraints) == {}
    assert "node_modules/cspell" in node_pin.unsatisfied(20, constraints)


def test_optional_platform_builds_never_constrain_the_pin():
    """`@img/sharp-win32-ia32` declares `^20.9.0` and is skipped on every platform but
    one. Counted, it would make every pin above 20 look impossible."""
    assert not any(name.endswith("sharp-win32-ia32") for name, _ in node_pin.engine_constraints())
