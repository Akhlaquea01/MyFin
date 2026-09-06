# Implementation Plan: Recurring & Budget Notifications

**Branch**: `004-recurring-budget-notifications` | **Date**: 2026-09-06 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-recurring-budget-notifications/spec.md`

## Summary

When the user unlocks/opens the app, it checks for recurring expected events due within a
configurable lead time and budgets that have newly crossed a configurable spending
threshold, and shows a browser Notification for each newly-qualifying item — never
duplicating one already shown, and never claiming delivery while the app is fully closed.
Technical approach: two new pure functions (`findDueRecurringEvents`,
`findCrossedBudgetThresholds`) in a new `src/domain/notifications/` engine, reusing spec
001's existing `recurringEngine`/`budgetEngine` for the underlying data; a new
`NotificationPreference` singleton and a `NotifiedItem` dedupe log, both new small Dexie
tables; and a thin orchestrator wired into the same per-unlock hook point
`BiometricEnrollmentPrompt` already uses. No new dependency — the native `Notification` API
only, no push subscription.

## Technical Context

**Language/Version**: TypeScript 5.x, same evergreen-browser target as the core app (Vite)

**Primary Dependencies**: No new dependencies. Reuses React 19 + React Router, shadcn/ui on
Tailwind CSS, Dexie.js, and Vitest — all already in the core app's stack (see
[../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md)). Uses
the native `Notification` API and the Service Worker `vite-plugin-pwa` already registers;
no new push/notification library.

**Storage**: IndexedDB via Dexie.js — two new tables, `notificationPreferences` and
`notifiedItems`; no server-side or cloud storage, no push subscription endpoint

**Testing**: Vitest unit tests for the two pure candidate-selection functions (lead-time and
threshold boundaries, per-period dedupe key), a Dexie integration test for both new
repositories, and a Playwright E2E test using `context.grantPermissions(['notifications'])`
to deterministically control browser permission state

**Target Platform**: Same installable PWA (Android/iOS/desktop); notification permission and
support vary by browser — the feature must degrade to in-app-only visibility everywhere
without erroring (FR-007/FR-008)

**Project Type**: Web — single frontend-only project (no backend exists or is planned)

**Performance Goals**: The on-open check (event/budget scan + dedupe lookup) completes
imperceptibly fast relative to app load — reuses the same `generateExpectedEvents`/
`ensureCurrentBudgetItem` calls `RecurringUpcomingPage`/`BudgetsPage` already make on their
own mount, so it adds no new expensive computation, only a candidate filter over data
already being fetched

**Constraints**: MUST NOT claim or imply guaranteed delivery while the app/browser is fully
closed (FR-008); MUST NOT show a duplicate notification for the same expected event or
budget-period-threshold combination (FR-004); MUST degrade silently (no error) when the
`Notification` API is unsupported or permission is denied (FR-007)

**Scale/Scope**: Single user per installation; 3 prioritized user stories, 8 functional
requirements (see [spec.md](spec.md))

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                       | Check                                                                                                                                                                                                                                                                   | Status                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| I. Local-First & Zero-Server                    | Notifications are triggered client-side on app-open, using the local `Notification` API; no push service, no server contacted at any point                                                                                                                              | PASS                                         |
| II. Privacy & Encryption by Default             | `NotificationPreference` and `NotifiedItem` are stored through the same Dexie/encryption layer as all other financial data; notification text is composed in-memory at dispatch time and never persisted in plaintext                                                   | PASS                                         |
| III. Layered Clean Architecture                 | `src/domain/notifications/notificationEngine.ts`'s pure functions depend only on plain data; the orchestrator depends only on repository interfaces and the `recurringEngine`/`budgetEngine` domain modules, never on Dexie/React directly from a component             | PASS                                         |
| IV. Test-First for Financial Logic              | Not one of the four engines named explicitly in Principle IV, but — per the precedent set in specs 002/003 — held to the same bar since threshold-crossing is money-derived logic; unit tests against fixtures MUST exist and pass before the engine is considered done | PASS (process gate, enforced in tasks phase) |
| V. Free & Open-Source Only                      | Zero new dependencies; native `Notification` API only                                                                                                                                                                                                                   | PASS                                         |
| VI. Data Integrity & Non-Destructive Operations | New fields are integers/booleans/strings with no monetary computation of their own; the dedupe log is additive-only (never mutated, only checked-and-inserted); no destructive operation is introduced                                                                  | PASS                                         |

No violations identified. **Complexity Tracking is not needed for this plan.**

### Post-Design Re-Check

Re-evaluated after Phase 1 (data-model.md, contracts/notification-engine.md, quickstart.md):

- `contracts/notification-engine.md` confirms both selection functions are pure (plain data
  in, candidates out, no I/O) — Principle III intact.
- The orchestrator's dedupe-then-dispatch-then-log sequence (research.md §2) ensures a
  candidate is never logged as notified unless a real notification was dispatched —
  preventing the "silently marked handled" bug class Principle VI's non-destructive-
  operations concern exists to catch, applied here to notification state rather than money.
- No new external dependency appears anywhere in data-model.md or the contract — Principle V
  intact.
- FR-007's in-app fallback requires no new UI (research.md §4) — confirmed by inspecting the
  existing `RecurringUpcomingPage`/`BudgetProgressCard`, so this plan does not duplicate
  data those screens already show.

**Result: PASS, no new violations. Complexity Tracking remains empty.**

## Project Structure

### Documentation (this feature)

```text
specs/004-recurring-budget-notifications/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── notification-engine.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── domain/
│   └── notifications/                    # NEW: pure candidate-selection engine
│       ├── notificationEngine.ts          # findDueRecurringEvents(), findCrossedBudgetThresholds()
│       ├── runNotificationCheck.ts         # impure orchestrator (reads, dedupe, dispatch)
│       └── types.ts                         # NotificationCandidate, etc.
│
├── data/
│   └── dexie/
│       ├── db.ts                           # EXTENDED: notificationPreferences, notifiedItems tables
│       └── notificationRepository.ts       # NEW: NotificationPreferenceRepository, NotifiedItemRepository
│
├── components/
│   └── NotificationPermissionPrompt.tsx    # NEW: one-time dismissible banner (mirrors
│                                               BiometricEnrollmentPrompt.tsx), mounted from App.tsx's Gate
├── pages/
│   └── NotificationSettingsPage.tsx        # NEW: enable/disable, lead-time, threshold (Story 3)
└── App.tsx                                 # MODIFIED: calls runNotificationCheck() from Gate's
                                                handleUnlock (research.md §3), mounts the new banner

tests/
├── unit/
│   └── notificationEngine.test.ts          # NEW
├── integration/
│   └── notificationRepositories.test.ts    # NEW
└── e2e/
    └── recurringBudgetNotifications.spec.ts # NEW
```

**Structure Decision**: Extends the existing single frontend-only project layout unchanged
(see [../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md)'s
Structure Decision, also reused as-is by specs 002 and 003). This feature adds one new
domain engine directory, one new repository module, one new settings page, one new banner
component, and extends the existing Dexie schema and `App.tsx`'s Gate — no new
architectural layer, no new project.
