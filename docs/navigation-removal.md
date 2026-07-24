# Navigation removal

## Removed

- Python autonomous scanner, semantic frontier, UI-Venus planner, local-model scanner, and Python requirements.
- Rust action selection, frontier, graph, route planning, recovery, replay, selector, screen observation, and stability modules.
- Autonomous Tauri command and Python child-process management.
- Scan progress, model-decision, frontier, and autonomous controls in React.
- Navigation-state, action, transition, selector, frontier, restoration-route, and checkpoint tables.
- Petgraph and Python/model runtime requirements.

## Database migration

The inspector schema is version 2. New databases contain projects, environments, devices, sessions, transactions, headers, body artifacts, endpoint identities, observations, approved baselines, comparisons, differences, incidents, interaction windows, correlations, performance samples, issues, rules, and artifacts.

Navigator tables are not created. Existing navigator databases should be retained as backups; traffic payload migration may be added when real legacy capture data exists.

## Preserved

Rust ADB discovery, installed-app discovery, package validation, and explicit app launch are reusable. Launch is user initiated and does not begin navigation.

## Replacement

A lifecycle-managed Hudsucker proxy captures traffic; Rust redacts, persists, compares, parses diagnostics, correlates incidents, and emits incremental Tauri events. The developer controls the Android app manually.
