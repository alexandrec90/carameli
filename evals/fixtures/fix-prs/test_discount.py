from discount import discounted_price


def test_discount_subtracts() -> None:
    assert discounted_price(100, 20) == 80
