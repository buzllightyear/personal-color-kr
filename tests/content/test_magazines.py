"""Unit tests for the prebuilt monthly magazine catalogue (Sub-AC 3.2).

The magazine catalogue is the *retention* surface — a sliding window
of 1–3 calendar-month editorial issues that the publisher layer
(Sub-AC 11.4) cycles through. These tests cover the AC headline
guarantees:

  - **Per-month data exists.** ``get_magazine_by_month`` returns the
    seeded issue for every month the catalogue ships, and ``Magazine``
    issues survive the round-trip with all required fields intact.
  - **Required fields populated.** Every issue carries a non-empty
    Korean ``issue_title``, ``cover_headline``, ``editor_letter`` and
    a 4-article roster — one article per ``Season``, none missing.
  - **Lookup function semantics.** ``get_magazine_by_month`` rejects
    malformed months (wrong type, wrong shape, unknown key) with
    clear errors instead of silent ``None``.
  - **Per-season article coverage.** Every issue carries exactly one
    article per Season — so the personalised post-payment screen
    always has a "for me" article regardless of which color the user
    received.
  - **Immutability.** Frozen dataclasses, tuple collections — usable
    as hashable keys in the publisher's analytics layer.

Marker: every test is ``@pytest.mark.unit`` — pure data, no I/O.
"""

from __future__ import annotations

import dataclasses

import pytest

from content.magazines import (
    Magazine,
    MagazineArticle,
    available_months,
    get_article_for_season,
    get_magazine_by_month,
    load_all_magazines,
)
from personal_color.season_classifier import Season


# ---------------------------------------------------------------------------
# Catalogue cardinality — the AC headline ("1-3개월치") invariant
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_catalogue_seeds_between_one_and_three_issues() -> None:
    """Seed contract: 1-3개월치 매거진 사전 콘텐츠."""
    count = len(load_all_magazines())
    assert 1 <= count <= 3, (
        f"magazine catalogue must seed 1-3 issues, got {count}"
    )


@pytest.mark.unit
def test_available_months_returns_unique_yyyy_mm_keys() -> None:
    months = available_months()
    assert len(months) == len(set(months)), (
        "available_months must contain no duplicates"
    )
    for month in months:
        assert isinstance(month, str)
        assert len(month) == 7 and month[4] == "-"
        year, mm = month.split("-")
        assert year.isdigit() and len(year) == 4
        assert mm.isdigit() and 1 <= int(mm) <= 12


@pytest.mark.unit
def test_available_months_is_chronologically_ordered() -> None:
    """Canonical order is oldest → newest so the publisher can pop()."""
    months = available_months()
    assert list(months) == sorted(months), (
        f"available_months must be ascending; got {months}"
    )


# ---------------------------------------------------------------------------
# Required field validation — Korean signature copy is part of the contract
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_every_issue_has_non_empty_required_fields() -> None:
    for magazine in load_all_magazines():
        assert magazine.issue_title.strip(), (
            f"empty issue_title on {magazine.month}"
        )
        assert magazine.cover_headline.strip(), (
            f"empty cover_headline on {magazine.month}"
        )
        assert magazine.editor_letter.strip(), (
            f"empty editor_letter on {magazine.month}"
        )


@pytest.mark.unit
def test_every_issue_title_contains_hangul() -> None:
    """No placeholder English titles — creator-signature voice required."""
    for magazine in load_all_magazines():
        assert _contains_hangul(magazine.issue_title), (
            f"issue_title without hangul on {magazine.month}: "
            f"{magazine.issue_title!r}"
        )


@pytest.mark.unit
def test_every_cover_headline_contains_hangul() -> None:
    for magazine in load_all_magazines():
        assert _contains_hangul(magazine.cover_headline), (
            f"cover_headline without hangul on {magazine.month}"
        )


@pytest.mark.unit
def test_every_editor_letter_contains_hangul() -> None:
    for magazine in load_all_magazines():
        assert _contains_hangul(magazine.editor_letter), (
            f"editor_letter without hangul on {magazine.month}"
        )


# ---------------------------------------------------------------------------
# Per-season article coverage — every issue has 1 article per Season
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_every_issue_has_exactly_four_articles() -> None:
    for magazine in load_all_magazines():
        assert len(magazine.articles) == 4, (
            f"{magazine.month} must have 4 articles, "
            f"got {len(magazine.articles)}"
        )


@pytest.mark.unit
def test_every_issue_covers_all_four_seasons_exactly_once() -> None:
    for magazine in load_all_magazines():
        seasons = [a.season for a in magazine.articles]
        assert set(seasons) == set(Season), (
            f"{magazine.month} missing seasons: "
            f"{set(Season) - set(seasons)}"
        )
        assert len(set(seasons)) == 4  # no duplicates


@pytest.mark.unit
def test_every_article_has_non_empty_title_summary_body() -> None:
    for magazine in load_all_magazines():
        for article in magazine.articles:
            assert article.title.strip(), (
                f"empty article.title on "
                f"{magazine.month}/{article.season.name}"
            )
            assert article.summary.strip(), (
                f"empty article.summary on "
                f"{magazine.month}/{article.season.name}"
            )
            assert article.body.strip(), (
                f"empty article.body on "
                f"{magazine.month}/{article.season.name}"
            )


@pytest.mark.unit
def test_every_article_copy_contains_hangul() -> None:
    for magazine in load_all_magazines():
        for article in magazine.articles:
            assert _contains_hangul(article.title), (
                f"article title without hangul on "
                f"{magazine.month}/{article.season.name}"
            )
            assert _contains_hangul(article.summary), (
                f"article summary without hangul on "
                f"{magazine.month}/{article.season.name}"
            )
            assert _contains_hangul(article.body), (
                f"article body without hangul on "
                f"{magazine.month}/{article.season.name}"
            )


# ---------------------------------------------------------------------------
# Lookup API — get_magazine_by_month (the AC-named function)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_get_magazine_by_month_returns_seeded_issue_for_every_month() -> None:
    """Per-month data exists — every available month resolves."""
    for month in available_months():
        magazine = get_magazine_by_month(month)
        assert isinstance(magazine, Magazine)
        assert magazine.month == month


@pytest.mark.unit
def test_get_magazine_by_month_returns_the_correct_issue() -> None:
    """Lookup must not silently return the wrong month."""
    months = available_months()
    for month in months:
        result = get_magazine_by_month(month)
        assert result.month == month, (
            f"requested {month!r}, got {result.month!r}"
        )


@pytest.mark.unit
def test_get_magazine_by_month_rejects_non_string() -> None:
    with pytest.raises(TypeError, match="must be a 'YYYY-MM' string"):
        get_magazine_by_month(202605)  # type: ignore[arg-type]


@pytest.mark.unit
@pytest.mark.parametrize(
    "bad_month",
    ["", "2026-5", "2026/05", "26-05", "2026-13", "2026-00", "not-a-month"],
)
def test_get_magazine_by_month_rejects_malformed_month(bad_month: str) -> None:
    with pytest.raises(ValueError, match="'YYYY-MM' string"):
        get_magazine_by_month(bad_month)


@pytest.mark.unit
def test_get_magazine_by_month_raises_keyerror_for_unknown_month() -> None:
    with pytest.raises(KeyError, match="no magazine issue registered"):
        get_magazine_by_month("1999-01")


# ---------------------------------------------------------------------------
# Article lookup helper — get_article_for_season
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("season", list(Season))
def test_get_article_for_season_returns_matching_article(
    season: Season,
) -> None:
    for month in available_months():
        article = get_article_for_season(month, season)
        assert isinstance(article, MagazineArticle)
        assert article.season is season


@pytest.mark.unit
def test_get_article_for_season_rejects_non_season() -> None:
    month = available_months()[0]
    with pytest.raises(TypeError, match="season must be a Season enum"):
        get_article_for_season(month, "spring")  # type: ignore[arg-type]


@pytest.mark.unit
def test_get_article_for_season_propagates_month_keyerror() -> None:
    with pytest.raises(KeyError):
        get_article_for_season("1999-01", Season.SPRING)


# ---------------------------------------------------------------------------
# Immutability — frozen dataclasses, tuple collections
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_magazine_is_frozen_dataclass() -> None:
    magazine = load_all_magazines()[0]
    with pytest.raises(dataclasses.FrozenInstanceError):
        magazine.issue_title = "edited"  # type: ignore[misc]


@pytest.mark.unit
def test_magazine_article_is_frozen_dataclass() -> None:
    article = load_all_magazines()[0].articles[0]
    with pytest.raises(dataclasses.FrozenInstanceError):
        article.title = "edited"  # type: ignore[misc]


@pytest.mark.unit
def test_articles_collection_is_tuple_not_list() -> None:
    for magazine in load_all_magazines():
        assert isinstance(magazine.articles, tuple)


@pytest.mark.unit
def test_magazine_is_hashable() -> None:
    """Frozen + tuple fields → hashable; usable in analytics sets/dicts."""
    magazines = load_all_magazines()
    assert len({hash(m) for m in magazines}) == len(magazines)


# ---------------------------------------------------------------------------
# Constructor validation — defends against future content rewrites
# ---------------------------------------------------------------------------


def _full_article_set() -> tuple[MagazineArticle, ...]:
    """Build a canonical 4-article roster (one per Season) for tests."""
    return tuple(
        MagazineArticle(
            season=season,
            title=f"t-{season.slug}",
            summary=f"s-{season.slug}",
            body=f"b-{season.slug}",
        )
        for season in Season
    )


@pytest.mark.unit
def test_magazine_rejects_wrong_article_count() -> None:
    with pytest.raises(ValueError, match="exactly 4 articles"):
        Magazine(
            month="2099-01",
            issue_title="t",
            cover_headline="c",
            editor_letter="e",
            articles=(),
        )


@pytest.mark.unit
def test_magazine_rejects_duplicate_seasons() -> None:
    dup_articles = tuple(
        MagazineArticle(
            season=Season.SPRING,
            title=f"t-{i}",
            summary=f"s-{i}",
            body=f"b-{i}",
        )
        for i in range(4)
    )
    with pytest.raises(ValueError, match="every Season exactly once"):
        Magazine(
            month="2099-01",
            issue_title="t",
            cover_headline="c",
            editor_letter="e",
            articles=dup_articles,
        )


@pytest.mark.unit
def test_magazine_rejects_invalid_month_shape() -> None:
    with pytest.raises(ValueError, match="'YYYY-MM' string"):
        Magazine(
            month="not-a-month",
            issue_title="t",
            cover_headline="c",
            editor_letter="e",
            articles=_full_article_set(),
        )


@pytest.mark.unit
def test_magazine_rejects_empty_issue_title() -> None:
    with pytest.raises(ValueError, match="issue_title must be a non-empty"):
        Magazine(
            month="2099-01",
            issue_title="",
            cover_headline="c",
            editor_letter="e",
            articles=_full_article_set(),
        )


@pytest.mark.unit
def test_magazine_rejects_empty_editor_letter() -> None:
    with pytest.raises(ValueError, match="editor_letter must be a non-empty"):
        Magazine(
            month="2099-01",
            issue_title="t",
            cover_headline="c",
            editor_letter="   ",
            articles=_full_article_set(),
        )


@pytest.mark.unit
def test_magazine_article_rejects_wrong_season_type() -> None:
    with pytest.raises(TypeError, match="season must be a Season enum"):
        MagazineArticle(
            season="spring",  # type: ignore[arg-type]
            title="t",
            summary="s",
            body="b",
        )


@pytest.mark.unit
def test_magazine_article_rejects_empty_body() -> None:
    with pytest.raises(ValueError, match="body must be a non-empty string"):
        MagazineArticle(
            season=Season.SPRING,
            title="t",
            summary="s",
            body="",
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _contains_hangul(text: str) -> bool:
    """Return True iff ``text`` contains at least one Hangul syllable.

    Hangul Syllables block: U+AC00..U+D7A3. Mirror of the helper in
    ``tests/content/test_curations.py`` so a regression to placeholder
    English copy fails the same way across content modules.
    """
    return any(0xAC00 <= ord(ch) <= 0xD7A3 for ch in text)
