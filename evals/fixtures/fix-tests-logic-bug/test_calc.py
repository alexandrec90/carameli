from calc import line_total


def test_line_total_multiplies() -> None:
    assert line_total(5, 3) == 15
