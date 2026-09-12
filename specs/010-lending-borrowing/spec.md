# Feature Specification: Personal Lending & Borrowing (IOU) Tracking

**Feature Branch**: `010-lending-borrowing`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Personal lending & borrowing (IOU) tracking: let a user record money lent to or borrowed from a person (not a financial institution), log partial repayments over time against each loan, see the derived pending/outstanding balance per person, get overdue reminders, and have net worth correctly reflect open receivables/payables. Builds on the existing SavingsGoal + GoalContribution derived-balance pattern. Core pieces: a Person contact entity; a PersonLoan record (direction lent/borrowed, principal, date, due date, linked account); a LoanRepayment ledger entry (partial amounts allowed, linked account); a People list page showing net position per person with overdue flags; a Dashboard summary tile (\"you're owed X / you owe Y\"); write-off support to zero a balance without a real money movement; and net worth snapshot updates so open lent/borrowed balances count as assets/liabilities respectively."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Record money lent or borrowed (Priority: P1)

A user lends cash to a friend, or borrows cash from a family member, and wants that immediately reflected in their account balance and tracked as an open IOU tied to that person, instead of it silently vanishing as an uncategorized expense or income.

**Why this priority**: This is the entry point for the entire feature. Without the ability to record a loan against a person and an account, nothing else (repayments, balances, reminders) has anything to operate on.

**Independent Test**: Can be fully tested by creating a person, recording a "lent" loan against one account and a "borrowed" loan against another, and verifying both loans appear as open with the correct principal, and the linked accounts' balances move by the correct amount in the correct direction.

**Acceptance Scenarios**:

1. **Given** no existing people, **When** the user records a new loan and enters a new person's name inline, **Then** a Person record is created and the loan is associated with them.
2. **Given** an existing person and an existing account with a known balance, **When** the user records a "lent" loan of a given amount against that account, **Then** the account's balance decreases by that amount and the loan appears as open with a pending balance equal to the principal.
3. **Given** an existing person and an existing account, **When** the user records a "borrowed" loan of a given amount against that account, **Then** the account's balance increases by that amount and the loan appears as open with a pending balance equal to the principal.
4. **Given** a loan being recorded, **When** the user optionally sets a due date, **Then** the due date is saved and shown on the loan.

---

### User Story 2 - Log a partial or full repayment (Priority: P2)

Weeks after lending or borrowing money, the person pays back some or all of it. The user wants to log exactly what came back (or what they paid back) without having to close out and re-create the whole loan, and see the remaining balance update immediately.

**Why this priority**: Partial repayment tracking is the feature's core differentiator over a simple one-off "IOU" note — most informal loans are repaid in installments, not all at once.

**Independent Test**: Can be fully tested by creating a loan with a known principal, logging one repayment smaller than the principal, and verifying the loan's pending balance decreases by exactly that amount while the loan stays open; then logging a second repayment that brings the balance to zero and verifying the loan becomes settled.

**Acceptance Scenarios**:

1. **Given** an open "lent" loan with a pending balance, **When** the user logs a repayment for part of that balance against an account, **Then** the account's balance increases by the repayment amount, the loan's pending balance decreases by the same amount, and the loan remains open.
2. **Given** an open "borrowed" loan with a pending balance, **When** the user logs a repayment for part of that balance against an account, **Then** the account's balance decreases by the repayment amount and the loan's pending balance decreases by the same amount.
3. **Given** an open loan with a pending balance of X, **When** the user logs a repayment exactly equal to X, **Then** the loan's pending balance becomes zero and the loan is shown as settled.
4. **Given** an open loan with a pending balance of X, **When** the user attempts to log a repayment greater than X, **Then** the system rejects the entry and explains the repayment cannot exceed the remaining balance.
5. **Given** a settled loan, **When** the user views its history, **Then** every repayment that was logged against it is still visible in order.

---

### User Story 3 - See who owes what at a glance (Priority: P3)

The user wants a single place that lists every person they've lent to or borrowed from, each person's net outstanding position, and which of those balances are overdue — without having to open each loan individually.

**Why this priority**: Aggregated visibility is what makes the tracking useful day-to-day; without it the user would need to remember and manually total every open loan.

**Independent Test**: Can be fully tested by creating loans (some lent, some borrowed, some overdue) across several people and verifying the People list shows the correct net position and overdue flag for each, and that a dashboard tile shows the correct totals across all people.

**Acceptance Scenarios**:

1. **Given** a person with one open "lent" loan and one open "borrowed" loan, **When** the user views that person in the People list, **Then** the displayed net position equals the outstanding lent amount minus the outstanding borrowed amount for that person.
2. **Given** an open loan whose due date has passed and whose pending balance is greater than zero, **When** the user views the People list, **Then** that person is flagged as having an overdue balance.
3. **Given** several people with open loans, **When** the user views the Dashboard, **Then** a summary tile shows the total amount outstanding that is owed to the user and the total amount outstanding that the user owes, summed across all people.
4. **Given** a person with no open loans (all settled or written off), **When** the user views the People list, **Then** that person shows a net position of zero and is not counted in overdue totals.

---

### User Story 4 - Get reminded about overdue loans (Priority: P4)

The user set a due date on a loan and wants to be proactively reminded once it's overdue, the same way they're already reminded about upcoming bills, instead of having to remember to check the People list.

**Why this priority**: Turns the feature from a passive ledger into an active reminder system, but the loan tracking itself (P1-P3) already delivers value without it.

**Independent Test**: Can be fully tested by creating a loan with a due date in the past and an outstanding balance, and verifying a reminder is surfaced for it once, without being repeated for the same overdue occurrence on every subsequent app open.

**Acceptance Scenarios**:

1. **Given** an open loan whose due date has passed and whose pending balance is greater than zero, **When** the user next opens the app, **Then** a reminder is surfaced referencing that loan and person.
2. **Given** a reminder has already been surfaced for a specific overdue loan, **When** the user opens the app again with no new repayment logged, **Then** the same reminder is not surfaced a second time.
3. **Given** an overdue loan, **When** the user logs a repayment that settles it in full, **Then** no further reminders are surfaced for that loan.

---

### User Story 5 - Write off a loan (Priority: P5)

Sometimes a loan will never be repaid — the user decides to forgive it. They want to close it out and stop it counting toward outstanding totals, while keeping a record that it happened, without pretending money actually changed hands.

**Why this priority**: A convenience/closure action that keeps outstanding totals honest; the loan history remains useful and correct even without this, just permanently "open."

**Independent Test**: Can be fully tested by creating an open loan, writing it off, and verifying its pending balance becomes zero, it is excluded from outstanding totals and overdue flags, and no account balance changes as a result.

**Acceptance Scenarios**:

1. **Given** an open loan with a pending balance, **When** the user writes it off, **Then** the loan's pending balance becomes zero, it is marked settled-by-write-off, and no linked account's balance changes.
2. **Given** a written-off loan, **When** the user views that person's history, **Then** the loan and the write-off are both still visible with the original principal and the amount that was forgiven.
3. **Given** a written-off loan, **When** totals are computed for the People list or Dashboard tile, **Then** the written-off amount is excluded from outstanding totals.

---

### Edge Cases

- What happens when a user tries to record a loan with a zero or negative principal amount? The system MUST reject it.
- What happens when a user records a repayment or write-off against a loan that is already fully settled? The system MUST reject it, since there is no remaining balance to apply it to.
- What happens when the due date entered is already in the past at the time the loan is created? The system MUST accept it and immediately treat the loan as overdue (subject to User Story 4's reminder behavior).
- What happens when a person has multiple loans in both directions (some lent, some borrowed, some settled, some open)? Net position MUST only be computed from currently-open (non-zero pending balance) loans; settled and written-off loans contribute zero.
- What happens when the account linked to an open loan is deleted or archived? The loan record and its history MUST remain intact and visible; the system MUST clearly indicate the linked account is no longer active.
- What happens when a user tries to delete a Person who still has one or more open loans? The system MUST block the deletion and explain that open loans must be settled or written off first.
- What happens when a user deletes a Person with no open loans? The system MUST soft-delete the person (recoverable via the existing trash/undo mechanism) while preserving their historical loan and repayment records.
- What happens if a repayment is logged in error? The system MUST allow the repayment record itself to be soft-deleted/undone, which restores the prior pending balance.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST allow the user to create a Person record identified by name, optionally with free-text notes, either from a dedicated screen or inline while recording a loan.
- **FR-002**: The system MUST allow the user to record a new loan (a "PersonLoan") specifying: the person, a direction (money lent to them, or money borrowed from them), a principal amount, a date, an account the money moved through, and an optional due date and notes.
- **FR-003**: Recording a "lent" loan MUST decrease the linked account's balance by the principal amount; recording a "borrowed" loan MUST increase the linked account's balance by the principal amount, via the same transaction mechanism used elsewhere in the app.
- **FR-004**: The system MUST allow the user to log a repayment against any open loan, specifying an amount, a date, and an account, and MUST support repayment amounts smaller than the loan's full remaining balance (partial repayment).
- **FR-005**: A repayment against a "lent" loan MUST increase the linked account's balance by the repayment amount; a repayment against a "borrowed" loan MUST decrease the linked account's balance by the repayment amount.
- **FR-006**: The system MUST compute each loan's pending (outstanding) balance as its principal minus the sum of its non-deleted repayments minus any write-off amount; this value MUST always be derived at display/query time and MUST NOT be independently stored in a way that can drift out of sync.
- **FR-007**: The system MUST reject a repayment (or write-off) that would bring a loan's pending balance below zero, and MUST explain to the user that the amount exceeds what remains outstanding.
- **FR-008**: The system MUST treat a loan as settled once its pending balance reaches zero, and MUST distinguish (for display purposes) whether it was settled through repayment or through write-off.
- **FR-009**: The system MUST provide a People list view showing, for each person with any loan history, their current net outstanding position (sum of open "lent" balances minus sum of open "borrowed" balances) and an overdue indicator when at least one of their open loans has a due date in the past.
- **FR-010**: The system MUST provide a Dashboard summary showing the total outstanding amount owed to the user and the total outstanding amount the user owes, aggregated across all people and open loans.
- **FR-011**: The system MUST allow the user to write off the remaining pending balance of an open loan, which MUST zero out its pending balance and exclude it from outstanding totals, without creating any change to an account's balance.
- **FR-012**: The system MUST preserve full loan and repayment history (including write-offs) for a person even after all their loans are settled, viewable on demand.
- **FR-013**: The system MUST surface a reminder for each loan that becomes overdue (due date passed with a pending balance greater than zero), using the app's existing reminder/notification mechanism, and MUST NOT repeat the same reminder for a loan that was already reminded about and remains in the same overdue state.
- **FR-014**: The system MUST include the total of all currently-open "lent" balances as an asset, and the total of all currently-open "borrowed" balances as a liability, in the app's net worth calculation.
- **FR-015**: The system MUST prevent deletion of a Person who has one or more open (non-zero pending balance) loans, and MUST explain why.
- **FR-016**: The system MUST support soft deletion (with recovery via the existing trash/undo mechanism) for Person, PersonLoan, and LoanRepayment records, consistent with the app's non-destructive data handling.
- **FR-017**: All monetary amounts introduced by this feature MUST be stored as integers in the smallest currency unit, consistent with the rest of the application.
- **FR-018**: The system MUST reject a loan or repayment entry with a zero or negative amount.

### Key Entities

- **Person**: A contact the user lends money to or borrows money from. Holds a name and optional notes. Not linked to phone contacts or any external directory. Has a derived net outstanding position across all their loans.
- **PersonLoan**: A single lending or borrowing event between the user and a Person. Holds a direction (lent/borrowed), principal amount, date, optional due date, optional notes, the account the principal moved through, and a derived pending balance and settlement status (open, settled-by-repayment, settled-by-writeoff).
- **LoanRepayment**: A single repayment logged against a PersonLoan. Holds an amount, a date, and the account the repayment moved through. Amounts across a loan's repayments, together with any write-off, determine its pending balance.
- **Write-off**: A closing action recorded against a PersonLoan that zeroes its remaining pending balance without moving money through any account, while preserving the original principal and repayment history.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can record a new loan, from opening the entry form to it appearing as an open loan, in under 30 seconds.
- **SC-002**: A user can log a repayment against an existing loan in under 15 seconds.
- **SC-003**: The pending balance shown for any loan always exactly equals its principal minus its logged repayments minus any write-off, with zero discrepancy, verifiable at any point in the loan's history.
- **SC-004**: A user can determine their total amount owed to them and total amount owed by them across every person by viewing a single dashboard tile, with no need to open individual loans.
- **SC-005**: 100% of loans that become overdue surface exactly one reminder before the next repayment or write-off is logged against them.
- **SC-006**: Net worth figures computed by the app match a manual calculation that includes open lending/borrowing balances as assets/liabilities, with zero discrepancy.

## Assumptions

- The application remains single-currency; loans and repayments are denominated in the same implicit currency as every other account and transaction, with no foreign-exchange conversion involved.
- This feature covers only two-party informal loans (the user and one other person); splitting a single expense across multiple people (group tab-splitting) is out of scope and may be a separate future feature.
- Interest accrual on personal loans is out of scope for this feature; loans are tracked as flat principal/repayment amounts only. This may be added later, following the pattern already used for institutional debt in the debt payoff planner.
- Overdue reminders reuse the existing notification preference and permission-prompt flow rather than introducing a separate opt-in.
- A Person record is purely local app data, not linked to device contacts or any external service, consistent with the app's local-first, zero-server principle.
- A repayment that would exceed a loan's remaining balance is rejected outright (the user must first correct the loan or log a smaller amount) rather than allowed to create a negative balance or an implicit reverse loan.
