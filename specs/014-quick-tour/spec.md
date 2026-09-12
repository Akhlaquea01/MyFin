# Feature Specification: Quick Tour (Guided Onboarding Walkthrough)

**Feature Branch**: `014-quick-tour`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "add a spec for a quick tour" — a guided walkthrough introducing a first-time user to the app's main areas (accounts, transactions, budgets, categorization, security/backup), distinct from the existing PIN-setup screen, that can also be replayed on demand later.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See a guided tour on first use (Priority: P1)

A brand-new user has just finished setting up their PIN on a fresh install with no data yet, and is looking at an empty app with no idea where to start. They want a short, guided walkthrough pointing out where to add an account, log a transaction, set a budget, and secure their data, instead of having to explore blindly.

**Why this priority**: This is the moment a new user is most likely to feel lost or abandon the app; a short orientation directly at first use delivers the feature's entire value.

**Independent Test**: Can be fully tested by completing PIN setup on a fresh install with no existing data and verifying the tour is automatically offered before or immediately after landing on the main app screen.

**Acceptance Scenarios**:

1. **Given** a fresh install with no existing data, **When** the user finishes initial PIN setup, **Then** the app offers to start a short guided tour.
2. **Given** the tour has started, **When** the user steps through it, **Then** each step highlights one key area of the app (e.g., accounts, adding a transaction, budgets, categorization, security/backup) with a brief, plain-language explanation of what it's for.
3. **Given** the user completes every step of the tour, **When** the last step finishes, **Then** the user is returned to normal use of the app with no further steps forced on them.
4. **Given** a user restores an existing backup instead of starting fresh, **When** their data loads, **Then** the tour is not automatically offered, since they are not a first-time user.

---

### User Story 2 - Skip the tour at any point (Priority: P1)

A user who is already familiar with personal finance apps doesn't want to sit through an introduction and wants to dismiss it immediately, or partway through, and get straight to using the app.

**Why this priority**: A tour that can't be escaped quickly would be an obstacle rather than a help; skippability is as essential as the tour itself.

**Independent Test**: Can be fully tested by starting the tour and dismissing it at the first step, partway through, and verifying full control of the app is restored immediately each time with no further forced steps.

**Acceptance Scenarios**:

1. **Given** the tour is showing its first step, **When** the user chooses to skip it, **Then** the tour closes immediately and the user has full control of the app.
2. **Given** the tour is midway through its steps, **When** the user chooses to skip it, **Then** the tour closes immediately without requiring the remaining steps to be viewed.
3. **Given** the user has skipped or completed the tour once, **When** they continue using the app normally, **Then** the tour does not automatically reappear.

---

### User Story 3 - Replay the tour later on demand (Priority: P2)

Some time later, the user wants a refresher, or a second person starts using a shared device and wants to see the same introduction, so they look for a way to bring the tour back up manually.

**Why this priority**: Extends the tour's value beyond the first session, but the app is fully usable without it — this is a convenience layered on top of User Stories 1-2.

**Independent Test**: Can be fully tested by locating the option to replay the tour from within the app's settings/help area at any time after the initial tour was dismissed or completed, and verifying it starts from the very first step.

**Acceptance Scenarios**:

1. **Given** the user has already seen or skipped the tour, **When** they look in the app's settings/help area, **Then** they find a clearly labeled option to view the tour again.
2. **Given** the user chooses to replay the tour, **When** it starts, **Then** it begins from the first step and behaves identically to the first-time experience, including being skippable.

---

### Edge Cases

- What happens if the user closes or reloads the app in the middle of the tour? The tour MUST NOT resume from the interrupted step; it is treated as dismissed, and can only be seen again via the manual replay option.
- What happens if a user with existing data (e.g., they restored a backup, or already used the app before this feature existed) opens the app after this feature ships? The tour MUST NOT be automatically offered to them, since automatic offering is reserved for genuinely first-time, no-data setups; they can still find it via manual replay.
- What happens if the user tries to interact with the app underneath the tour overlay (e.g., tapping a highlighted button)? The tour MUST NOT block or trap the user — dismissing it must always be available and obvious.
- What happens on a small mobile screen where a highlighted area and its explanation might not both fit comfortably? The tour step MUST remain fully readable and dismissible regardless of screen size.
- What happens if a user navigates to a different part of the app while the tour is open (where supported)? The tour MUST close or clearly disengage rather than showing a step that no longer matches what's on screen.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST automatically offer a guided quick tour the first time a user completes initial PIN setup on an install with no existing financial data.
- **FR-002**: The tour MUST consist of a short, ordered sequence of steps, each describing one key area of the app in plain language (at minimum: adding an account, logging a transaction, setting a budget, categorization, and securing/backing up data).
- **FR-003**: The user MUST be able to dismiss the tour at any step, which MUST immediately end it and return full control of the app with no further steps forced.
- **FR-004**: Once the tour has been dismissed or completed, the system MUST NOT automatically offer it again on subsequent app opens.
- **FR-005**: The system MUST NOT automatically offer the tour when the user's first action is restoring an existing backup rather than starting with no data.
- **FR-006**: The system MUST provide a way to manually start the tour again at any time from a discoverable location (e.g., settings or help), independent of whether it was previously seen.
- **FR-007**: The tour MUST be fully navigable and dismissible using the keyboard, and MUST NOT trap focus, consistent with the app's baseline accessibility expectations.
- **FR-008**: The system MUST remember, across app restarts, whether the automatic first-time tour has already been shown or dismissed, so it is only auto-offered once.

### Key Entities

- **Tour Preference**: A single, per-installation record of whether the automatic first-time tour has been shown or dismissed. Used only to decide whether to auto-offer the tour; does not affect the manual replay option, which is always available.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A first-time user can view or skip the entire tour in under 60 seconds.
- **SC-002**: 100% of fresh installs with no existing data are automatically offered the tour exactly once.
- **SC-003**: A user can relaunch the tour on demand in 2 actions or fewer from the settings/help area.
- **SC-004**: 100% of users who skip the tour experience no further automatic interruption from it during normal use.

## Assumptions

- The tour is a fixed, linear sequence of steps shown as an overlay, not a context-sensitive walkthrough that waits for the user to actually perform each action; this keeps the feature simple to build and predictable to test.
- The tour's automatic first appearance is tied to "no existing financial data yet," using the same signal already available from the onboarding/PIN-setup flow, rather than a separate "is this a new user" flag.
- Tour content does not need to be kept in perfect lockstep with every future UI change as a hard requirement of this feature; keeping it accurate over time is an ordinary maintenance concern, not a new functional requirement.
- The tour is presented in-app only; no separate video, external help site, or printed guide is in scope.
