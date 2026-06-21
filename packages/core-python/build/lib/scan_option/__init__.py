"""scan_option Python package.

The canonical scan-option catalogue lives in TypeScript
(`src/scan_option/catalogue.ts`) and feeds the funnel UI on Step 6.

This Python package mirrors the catalogue for server-side consumers — most
notably `src/personal_color/diagnosis_orchestrator.py`, which needs to look up
the main-scan option id and label without crossing a language boundary.

Both sides must stay in lock-step. The id list / role / slot / status fields
are deliberately identical to the TS source; the validators in
`src/scan_option/options.py` enforce the same invariants the TS schema does.
"""
