# Tasks: Quick Tour

## Phase 1: Setup
- [x] T001 Initialize `src/components/ui/quick-tour/` directory

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core state management and base component structure that ALL user stories depend on.

- [x] T002 [P] Create `useQuickTour.ts` hook in `src/hooks/useQuickTour.ts` for reading/writing `APP_QUICK_TOUR_SEEN` from `localStorage`
- [x] T003 [P] Create `QuickTourProvider.tsx` context in `src/components/ui/quick-tour/QuickTourProvider.tsx` to provide tour state to the app
- [x] T004 Create base `QuickTourOverlay.tsx` component in `src/components/ui/quick-tour/QuickTourOverlay.tsx` using absolute positioning or floating UI primitives

---

## Phase 3: User Story 1 - See a guided tour on first use (Priority: P1)

**Goal**: A brand-new user sees a short, guided walkthrough pointing out where to add an account, log a transaction, etc.
**Independent Test**: Can be fully tested by completing PIN setup on a fresh install with no existing data and verifying the tour is automatically offered.

### Implementation for User Story 1
- [x] T005 [P] [US1] Define tour steps data structure (target selector, title, description) in `src/components/ui/quick-tour/tour-steps.ts`
- [x] T006 [US1] Update `QuickTourOverlay.tsx` to position itself relative to the active step's target element using `getBoundingClientRect`
- [x] T007 [US1] Update `QuickTourOverlay.tsx` to handle Next/Previous step progression buttons
- [x] T008 [US1] Add logic in `QuickTourProvider.tsx` to check Dexie `accounts` and `transactions` tables to auto-start the tour if empty and `APP_QUICK_TOUR_SEEN` is false
- [x] T009 [US1] Update `App.tsx` (or main layout) to wrap the app with `QuickTourProvider` and render `QuickTourOverlay`

---

## Phase 4: User Story 2 - Skip the tour at any point (Priority: P1)

**Goal**: User can dismiss the tour immediately, or partway through, and get straight to using the app.
**Independent Test**: Can be fully tested by starting the tour and dismissing it at any step, verifying full control of the app is restored immediately.

### Implementation for User Story 2
- [x] T010 [P] [US2] Add 'Skip Tour' and 'Close' buttons to `QuickTourOverlay.tsx`
- [x] T011 [P] [US2] Handle `Escape` key press in `QuickTourOverlay.tsx` to dismiss the tour without trapping focus
- [x] T012 [US2] Update `useQuickTour.ts` to set `APP_QUICK_TOUR_SEEN` to `"true"` in `localStorage` when the tour is skipped or completed

---

## Phase 5: User Story 3 - Replay the tour later on demand (Priority: P2)

**Goal**: User can bring the tour back up manually from settings.
**Independent Test**: Locate the option to replay the tour from within the app's settings area and verify it starts from the first step.

### Implementation for User Story 3
- [x] T013 [P] [US3] Update `useQuickTour.ts` to provide a manual `startTour()` function that resets to step 1 and opens the overlay
- [x] T014 [US3] Add a "Replay Quick Tour" button in `src/pages/SettingsPage.tsx` (or relevant help/settings component) that calls `startTour()`

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories
- [x] T015 [P] Add E2E tests for the Quick Tour flow in `tests/e2e/quick-tour.spec.ts` to verify auto-start, skippability, and manual replay
- [x] T016 Run quickstart.md validation manually to ensure tour works correctly on mobile screens and does not trap focus

---

## Dependencies & Execution Order

### Phase Dependencies
- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in sequential priority order (US1 -> US2 -> US3)

### Parallel Opportunities
- Foundational hooks and context provider (T002, T003) can be built in parallel.
- US2 tasks (T010, T011) can be implemented in parallel with US1 UI tasks once the base overlay exists.
- E2E test setup (T015) can be started in parallel once the component IDs/selectors are defined.
