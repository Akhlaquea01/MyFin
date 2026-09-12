# Implementation Plan: Quick Tour (Guided Onboarding Walkthrough)

**Branch**: `014-quick-tour` | **Date**: 2026-09-12 | **Spec**: [spec.md](file:///e:/MyFin/specs/014-quick-tour/spec.md)

**Input**: Feature specification from `e:\MyFin\specs\014-quick-tour\spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Implement a guided walkthrough introducing a first-time user to the app's main areas (accounts, transactions, budgets, categorization, security/backup). The tour will be a custom lightweight overlay utilizing existing `shadcn/ui` primitives and `getBoundingClientRect` to highlight sections without trapping focus. Tour completion state will be persisted in `localStorage`.

## Technical Context

**Language/Version**: TypeScript 5, React 18, Vite

**Primary Dependencies**: `shadcn/ui` (Radix UI Popover)

**Storage**: `localStorage` (for `APP_QUICK_TOUR_SEEN` preference)

**Testing**: Vitest (unit tests), Playwright (E2E testing)

**Target Platform**: Web/PWA (Mobile-first, Desktop compatible)

**Project Type**: Web application (PWA)

**Performance Goals**: N/A (UI overlay, minimal performance impact)

**Constraints**: Must NOT trap focus (accessibility requirement). Tour state must not be tied to encrypted Dexie DB since it is non-sensitive.

**Scale/Scope**: ~5-6 static steps highlighting main areas. 1 small state variable in `localStorage`.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **I. Local-First & Zero-Server**: PASS (Tour state is stored locally in `localStorage`, fully offline capable).
- **II. Privacy & Encryption by Default**: PASS (Tour preference is non-sensitive and stored in `localStorage`. No financial data is involved).
- **III. Layered Clean Architecture**: PASS (UI components remain in the UI layer. `localStorage` access can be abstracted via a hook or utility).
- **IV. Test-First for Financial Logic**: N/A (Tour does not affect financial calculations).
- **V. Free & Open-Source Only**: PASS (Using existing free/open-source shadcn/ui primitives. No proprietary SDKs).
- **VI. Data Integrity**: N/A (No financial records are created or modified).

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── components/
│   └── ui/
│       └── quick-tour/
│           ├── QuickTourOverlay.tsx
│           └── QuickTourProvider.tsx
├── hooks/
│   └── useQuickTour.ts
├── pages/
│   └── SettingsPage.tsx
└── tests/
    └── e2e/
        └── quick-tour.spec.ts
```

**Structure Decision**: The Tour logic and UI will reside under `src/components/ui/quick-tour/` as a reusable module. State management will be handled by a context provider (`QuickTourProvider.tsx`) and hook (`useQuickTour.ts`). Tests will be placed in the standard `tests/e2e/` folder.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

*(No violations)*
