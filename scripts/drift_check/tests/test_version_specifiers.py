from scripts.drift_check.version_specifiers import parse_specifier, is_satisfiable


def test_parse_single_clause():
    assert parse_specifier("<9.1") == [("<", (9, 1))]


def test_parse_multi_clause_comma_split():
    assert parse_specifier(">=9.1,<10") == [(">=", (9, 1)), ("<", (10,))]


def test_parse_empty_is_no_constraint():
    assert parse_specifier("") == []
    assert parse_specifier("   ") == []


def test_parse_unsupported_operator_returns_none():
    assert parse_specifier("~=9.1") is None
    assert parse_specifier("!=9.1") is None
    assert parse_specifier("===9.1") is None


def test_parse_garbage_returns_none():
    assert parse_specifier("pytest9") is None
    assert parse_specifier("<>9") is None


def test_real_pytest_pin_is_unsatisfiable():
    # the live drift: CI `<9.1` vs pyproject `>=9.1.1`
    clauses = parse_specifier("<9.1") + parse_specifier(">=9.1.1")
    assert is_satisfiable(clauses) is False


def test_overlapping_ranges_satisfiable():
    assert is_satisfiable(parse_specifier(">=9.1") + parse_specifier("<10")) is True


def test_point_equality_within_range_satisfiable():
    assert is_satisfiable(parse_specifier("==9.1.1") + parse_specifier(">=9.1")) is True


def test_point_equality_outside_range_unsatisfiable():
    assert is_satisfiable(parse_specifier("==9.0") + parse_specifier(">=9.1")) is False


def test_trailing_zero_normalization_satisfiable():
    # 9.1 == 9.1.0 : `<=9.1` ∧ `>=9.1.0` feasible exactly at 9.1
    assert is_satisfiable(parse_specifier("<=9.1") + parse_specifier(">=9.1.0")) is True


def test_trailing_zero_equivalence_in_tight_bound_selection():
    # max()/min() over raw tuples can pick a different-length but equal version;
    # these prove the inclusivity verdict stays correct across that normalization.
    assert (
        is_satisfiable(parse_specifier("==9.1") + parse_specifier("==9.1.0")) is True
    )  # same point
    assert (
        is_satisfiable(parse_specifier("==9.1") + parse_specifier(">9.1.0")) is False
    )  # 9.1 not > 9.1.0
    assert (
        is_satisfiable(parse_specifier(">9.1") + parse_specifier("<=9.1.0")) is False
    )  # (9.1, 9.1] empty
    # mixed-length, multiple lower+upper bounds collapse to the right interval [9.1.5, 9.3)
    assert (
        is_satisfiable(parse_specifier(">=9.1,>=9.1.5") + parse_specifier("<10,<9.3"))
        is True
    )


def test_exclusive_bound_touching_is_unsatisfiable():
    # nothing is both `<9.1` and `>=9.1`
    assert is_satisfiable(parse_specifier("<9.1") + parse_specifier(">=9.1")) is False


def test_single_sided_and_empty_are_satisfiable():
    assert is_satisfiable(parse_specifier(">=9.1")) is True
    assert is_satisfiable(parse_specifier("<9.1")) is True
    assert is_satisfiable([]) is True
