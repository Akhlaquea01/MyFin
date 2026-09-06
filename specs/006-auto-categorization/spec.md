# Feature Specification: Auto-Categorization Rules & Learning

**Feature Branch**: `006-auto-categorization`

**Created**: 2026-09-06

**Status**: Draft

**Input**: User description: "Custom recurring transaction rules for auto-categorization —
merchant-alias-based rules that auto-assign category/tags on Quick Add and CSV import,
reducing review-queue friction (builds on FR-010/FR-020). CSV/rule-based auto-categorization
learning — the app already flags duplicates; it could also learn from user corrections
(merchant X → category Y) to pre-fill future Quick Adds."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Define an Auto-Categorization Rule (Priority: P1)

A user creates a rule that says "transactions from merchant X should be categorized as
category Y (and optionally tagged Z)", so future transactions from that merchant — via
Quick Add, bulk text import, or file import — are pre-filled automatically.

**Why this priority**: Explicit rules are the most predictable, user-controlled way to
reduce review-queue friction, and are independently valuable without any learning behavior.

**Independent Test**: Create a rule mapping a merchant to a category, then process a new
Quick Add or import entry recognized as that merchant, and verify the resulting unreviewed
transaction is pre-filled with that category.

**Acceptance Scenarios**:

1. **Given** no rules exist, **When** the user creates a rule mapping a merchant to a
   category (and optionally tags), **Then** the rule is saved and listed among the user's
   rules.
2. **Given** an active rule for a merchant, **When** a new transaction is proposed via Quick
   Add, bulk text import, or file import and its merchant matches the rule, **Then** the
   proposed transaction is pre-filled with that rule's category and tags before the user
   reviews it.
3. **Given** a transaction was pre-filled by a rule, **When** the user reviews and confirms
   it, **Then** it is saved with the rule-assigned category/tags unless the user changed
   them first.
4. **Given** an existing rule, **When** the user edits or deletes it, **Then** future
   matching transactions reflect the change; already-confirmed past transactions are
   unaffected.

---

### User Story 2 - Suggested Category from Past Corrections (Priority: P2)

A user repeatedly recategorizes transactions from a given merchant to the same category
during review. The app notices this pattern and starts suggesting that category by default
for future transactions from that merchant, without the user having to define an explicit
rule.

**Why this priority**: Reduces manual rule-authoring effort for patterns the user has
already demonstrated through their own behavior, but is a refinement on top of the explicit
rules in Story 1, which already deliver the core value.

**Independent Test**: Confirm several transactions from the same merchant into the same
category without creating a rule, then verify a subsequent transaction from that merchant
is pre-filled with that category, marked as a suggestion.

**Acceptance Scenarios**:

1. **Given** the user has confirmed a defined minimum number of transactions from the same
   merchant into the same category, **When** a new transaction from that merchant is
   proposed, **Then** it is pre-filled with the learned category, visibly marked as a
   suggestion (distinct from a user-defined rule).
2. **Given** a learned suggestion is shown, **When** the user overrides it with a different
   category on confirmation, **Then** the learning updates to reflect the new pattern rather
   than persistently re-suggesting the overridden category.
3. **Given** a user-defined rule (Story 1) and a learned suggestion would conflict for the
   same merchant, **When** a transaction is proposed, **Then** the explicit rule takes
   precedence over the learned suggestion.

---

### User Story 3 - Review and Manage Learned Suggestions (Priority: P3)

A user views what the app has "learned" about a merchant and can promote a learned
suggestion into a permanent explicit rule, or dismiss/reset it.

**Why this priority**: Gives the user visibility and control over automatic behavior, but is
a management layer on top of Stories 1 and 2, which already function without it.

**Independent Test**: With a learned suggestion active for a merchant, promote it to an
explicit rule and verify it now behaves identically to a manually created rule; separately,
reset a learned suggestion and verify pre-filling stops until the pattern re-forms.

**Acceptance Scenarios**:

1. **Given** a learned suggestion exists for a merchant, **When** the user promotes it,
   **Then** an explicit rule is created matching that merchant/category pairing.
2. **Given** a learned suggestion exists, **When** the user resets/dismisses it, **Then** no
   further pre-filling occurs for that merchant until a new pattern is observed.

---

### Edge Cases

- What happens when a merchant has no recognizable name yet (e.g., a Quick Add parse that
  extracted no merchant)? No rule or learned suggestion can apply; the transaction proceeds
  to manual review as today.
- What happens when two different rules could both match the same transaction (e.g., a rule
  on the raw merchant alias and a rule on the canonical merchant)? The more specific match
  (exact alias) takes precedence over a broader one.
- What happens when the user's corrections are inconsistent (e.g., alternates between two
  categories for the same merchant with no clear majority)? The system should not force a
  suggestion when there is no dominant pattern, rather than guessing.
- What happens to existing already-confirmed transactions when a rule is created or a
  suggestion is learned? They are never retroactively changed — only future proposals are
  affected.
- What happens when a rule's target category is later deleted? The rule must be flagged as
  invalid and stop applying rather than silently assigning a nonexistent category.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Users MUST be able to create, edit, and delete a rule mapping a merchant (or
  merchant alias) to a category and, optionally, one or more tags.
- **FR-002**: System MUST apply a matching active rule to pre-fill category and tags on any
  newly proposed transaction (from Quick Add, bulk text import, or file import) before it
  reaches the user for review.
- **FR-003**: System MUST track, for each merchant, the category the user actually confirms
  transactions into, in order to detect a repeated pattern.
- **FR-004**: Once a merchant's confirmed-category pattern meets a defined consistency
  threshold, system MUST pre-fill new proposed transactions from that merchant with the
  learned category, visibly distinguished from an explicit rule's pre-fill.
- **FR-005**: When both an explicit rule and a learned suggestion apply to the same
  transaction, the explicit rule MUST take precedence.
- **FR-006**: Users MUST be able to view learned suggestions per merchant and either promote
  one to an explicit rule or dismiss/reset it.
- **FR-007**: Overriding a rule's or suggestion's pre-filled category during review MUST
  update the learning signal for that merchant, and MUST NOT alter any already-confirmed
  past transaction.
- **FR-008**: System MUST NOT apply a learned suggestion when the user's confirmation history
  for a merchant shows no dominant, consistent category.
- **FR-009**: A rule whose target category has been deleted MUST be flagged as invalid and
  MUST stop being applied until repaired or removed.

### Key Entities

- **Categorization Rule**: An explicit, user-authored mapping from a merchant (or merchant
  alias) to a category and optional tags; user-editable and deletable.
- **Merchant Category Signal** (internal): A running tally, per merchant, of which
  categories the user has confirmed transactions into, used to derive learned suggestions —
  not directly user-editable, but viewable and resettable.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For a merchant with an active explicit rule, 100% of newly proposed
  transactions from that merchant are pre-filled with the rule's category on first
  proposal.
- **SC-002**: The size of the unreviewed-transaction queue requiring a manual category
  change decreases measurably (target: by at least 30%) for users with active rules and/or
  established learned patterns, compared to no auto-categorization.
- **SC-003**: A learned suggestion never appears with fewer than the defined minimum number
  of consistent confirmations, verified with zero false-positive suggestions in a
  representative test data set.
- **SC-004**: Promoting a learned suggestion to a rule takes a single user action and is
  reflected in the very next proposed transaction for that merchant.

## Assumptions

- The consistency threshold for a learned suggestion (e.g., 3 consecutive confirmations to
  the same category) is a tunable internal default, not a user-facing setting in this
  version.
- Matching is merchant-based (using the existing Merchant/MerchantAlias entities), not
  free-text description matching, consistent with how parsed Quick Add/import data already
  resolves merchants.
- Rules and learned signals are local-only data, included in backup/restore like other
  application data, per Constitution Principle I.
