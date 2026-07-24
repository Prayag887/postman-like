# Debug report: visible-root recovery boundary exit

**Status:** DONE

## Symptom

The local scanner aborted with `RuntimeError: visible in-app root discovery left the target package` while recovering a queued navigation branch.

## Root cause

`discover_visible_root()` correctly detects when a recovery navigation control leaves the target Android package, but `recover_from_visible_root()` propagated that condition as an uncaught exception. The scan loop already handles ordinary failed recovery attempts, so it never reached its incomplete-coverage path.

## Fix

`recover_from_visible_root()` now converts that specific package-boundary condition into a failed recovery. The queued branch is retried and then recorded as unreachable by the existing scan workflow rather than crashing the scan.

## Evidence

- Added a regression test that simulates a visible Back action moving focus to `com.browser`.
- `python3 -m unittest tests/test_navigation.py` passed: 32 tests.
- `python3 -m py_compile scripts/autonomous_scan.py scripts/tests/test_navigation.py` passed.
- `cargo check -p app-tester-desktop` passed.
