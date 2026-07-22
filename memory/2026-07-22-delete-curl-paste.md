# Debug report: request deletion and direct cURL paste

- Symptom: deleting a newly created request appeared to do nothing; pasting cURL into the URL field left the whole command as the URL.
- Root cause: deletion assumed the request was already present in the saved collection. Unsaved request IDs produced index `-1`, so persistence wrote an unchanged collection. cURL parsing was only wired to a separate dialog.
- Fix: saved and unsaved deletion now share one selection-aware removal function and one in-app confirmation dialog. The URL field intercepts cURL paste and maps it onto the current request draft.
- Evidence: packaged macOS reproduction discarded an unsaved request and immediately selected `Send_OTP`. The complete workspace suite passes.
- Regression tests: `apps/desktop/src/App.test.ts` covers unsaved discard, saved neighbor selection, and cURL field mapping.
- Status: DONE
