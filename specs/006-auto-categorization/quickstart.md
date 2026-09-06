# Quickstart: Auto-Categorization Rules & Learning

Validation scenarios proving the feature works end-to-end, once implemented per
[plan.md](plan.md), [data-model.md](data-model.md), and
[contracts/categorization-engine.md](contracts/categorization-engine.md).

## Prerequisites

- App running locally (`npm run dev`) with onboarding completed and at least one account and
  category.
- The **Categorization Rules** screen (new, this feature) for creating rules and viewing
  learned suggestions.

## Scenario 1 — An explicit rule pre-fills every new transaction from that merchant (User Story 1)

1. Go to Categorization Rules → create a rule: merchant "Starbucks" → category "Dining", tag
   "Coffee".
2. Quick Add a transaction whose parsed merchant resolves to "Starbucks".
3. **Expect**: the resulting unreviewed transaction (visible in the Review Queue) already
   shows category "Dining" and tag "Coffee" — no manual categorization needed.
4. Repeat step 2 via bulk text import (one line) and via a file import (one CSV row with a
   description matching "Starbucks").
5. **Expect**: both also arrive pre-filled identically (SC-001).
6. Confirm the transaction from step 2 without changing anything.
7. **Expect**: it's saved with "Dining"/"Coffee" intact (Acceptance Scenario 3).

## Scenario 2 — Editing/deleting a rule only affects future transactions (User Story 1)

1. With the rule from Scenario 1 still active, edit it to target category "Coffee Shops"
   instead of "Dining".
2. **Expect**: the already-confirmed transaction from Scenario 1 still shows "Dining"; a new
   Quick Add for "Starbucks" now pre-fills "Coffee Shops".
3. Delete the rule entirely.
4. **Expect**: a new Quick Add for "Starbucks" no longer pre-fills any category (falls through
   to manual review, or to a learned suggestion if one has since formed — Scenario 3).

## Scenario 3 — A learned suggestion appears after a consistent streak, and is marked distinctly (User Story 2)

1. Ensure no rule exists for merchant "Uber".
2. Confirm three separate transactions from "Uber" into category "Transport" (via the Review
   Queue, each time explicitly choosing "Transport" since no pre-fill exists yet).
3. Propose a fourth "Uber" transaction (any entry path).
4. **Expect**: it arrives pre-filled with "Transport", visibly badged "Suggested" — distinct
   from a rule's pre-fill (FR-004).
5. On the fourth transaction's review, override the category to "Business Travel" and confirm.
6. **Expect**: the streak resets — a fifth "Uber" transaction is proposed with no suggestion
   pre-filled until "Business Travel" (or any single category) is confirmed 3 times running
   (Acceptance Scenario 2).

## Scenario 4 — Inconsistent history never forces a suggestion (Edge Case)

1. For a merchant with no rule, alternately confirm transactions into category A, then B,
   then A, then B (no 3-in-a-row streak ever forms).
2. Propose another transaction from that merchant.
3. **Expect**: no suggestion is pre-filled — it proceeds to manual review exactly as before
   this feature existed (FR-008).

## Scenario 5 — An explicit rule always wins over a learned suggestion (Acceptance Scenario 3, US2)

1. Build a 3-confirmation streak for merchant "Amazon" into category "Shopping" (as in
   Scenario 3), so a learned suggestion is now active for "Amazon" → "Shopping".
2. Create an explicit rule: merchant "Amazon" → category "Electronics".
3. Propose a new "Amazon" transaction.
4. **Expect**: it pre-fills "Electronics" (the rule), not "Shopping" (the suggestion) — no
   "Suggested" badge (FR-005).

## Scenario 6 — Promote a learned suggestion to a rule (User Story 3)

1. With the "Uber" → "Transport" suggestion active again (repeat Scenario 3 steps 1-2, without
   the override in step 5), go to Categorization Rules → Suggestions and click "Promote" on
   the "Uber" row.
2. **Expect**: an explicit rule "Uber" → "Transport" now appears in the rules list, and the
   very next "Uber" transaction proposal pre-fills with a rule (no "Suggested" badge) — a
   single action reflected on the very next proposal (SC-004).

## Scenario 7 — Reset a learned suggestion (User Story 3)

1. With an active suggestion for some merchant, go to Categorization Rules → Suggestions and
   click "Reset" on that merchant's row.
2. **Expect**: the suggestion disappears from the list, and the next transaction from that
   merchant is proposed with no pre-fill at all — pre-filling resumes only once a fresh
   3-confirmation streak re-forms (Acceptance Scenario 2, Story 3).

## Scenario 8 — A rule whose category was deleted stops applying (Edge Case)

1. Create a rule: merchant "Foo" → category "Bar".
2. Delete category "Bar" (soft delete, via Categories → Trash flow).
3. Propose a new "Foo" transaction.
4. **Expect**: no pre-fill from the stale rule (it does not crash or assign a nonexistent
   category); the Categorization Rules list shows the "Foo" rule flagged as invalid until it's
   repaired (re-pointed to a live category) or deleted.

## Automated coverage

These scenarios correspond to:

- `tests/unit/categorizationEngine.test.ts` — `pickBestRule`'s precedence ordering (Scenario
  5) and `deriveSuggestion`'s streak/reset boundaries (Scenarios 3, 4, 7).
- `tests/integration/categorizationRepositories.test.ts` — `CategorizationRuleRepository`
  (CRUD, soft-delete/restore, stale-category detection for Scenario 8) and
  `MerchantCategorySignalRepository` (push/cap/reset), plus `resolveCategorization`/
  `recordConfirmation` exercised against all three entry paths (Scenario 1).
- `tests/e2e/autoCategorization.spec.ts` — Scenarios 1, 2, 3, 5, 6, 7 end-to-end through the
  actual Quick Add, Review Queue, and Categorization Rules UI.
