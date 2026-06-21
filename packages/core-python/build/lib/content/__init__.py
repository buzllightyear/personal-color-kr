"""Prebuilt content package for the personal-color-kr MVP.

This package holds the *static* content the app ships to users between
billing-cycle magazine drops: the 16-guide library (Sub-AC 11.1, this file),
the 4 first-curation packages (Sub-AC 11.2), and the seed magazine issues
(Sub-AC 11.3 / 11.4).

The package is intentionally I/O-free — every entry is a Python literal so
the data is type-checked, immutable, and trivially loadable in tests
without fixtures or filesystem access. A future CMS-backed loader can
replace these module-level tuples without touching call sites because the
public API is loader *functions*, not the raw constants.
"""
