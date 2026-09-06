# Phase 1 Data Model: Savings Goals

Conventions follow the core app's data model (see
[../001-personal-finance-manager/data-model.md](../001-personal-finance-manager/data-model.md)):
UUID primary keys, integers for every monetary field, `createdAt`/`updatedAt` timestamps,
and AES-GCM-encrypted-at-rest storage for the plaintext shape described below.

## SavingsGoal (new)

| Field        | Type                | Notes                                                                              |
| ------------ | ------------------- | ---------------------------------------------------------------------------------- |
| id           | UUID                | PK                                                                                 |
| name         | string              | User-facing label, e.g. "Emergency Fund"                                           |
| targetAmount | integer             | Smallest currency unit; > 0                                                        |
| targetDate   | ISO date, nullable  | Optional; when absent, "on track/behind" status never applies (FR-006, Edge Cases) |
| deletedAt    | timestamp, nullable | Soft delete → trash (FR-007), mirrors the core app's pattern                       |
| createdAt    | timestamp           |                                                                                    |
| updatedAt    | timestamp           |                                                                                    |

**Note**: "current status" from the spec's Key Entities (achieved / on-track / behind /
insufficient-data) is deliberately **not** a stored field — see research.md §5. It is always
computed from a goal's contributions at read time, the same way this app already treats
budget adherence and net worth as derived rather than cached.

## GoalContribution (new)

| Field     | Type      | Notes                                                                               |
| --------- | --------- | ----------------------------------------------------------------------------------- |
| id        | UUID      | PK                                                                                  |
| goalId    | UUID      | FK → SavingsGoal                                                                    |
| amount    | integer   | Smallest currency unit; non-zero; may be negative for a correction (research.md §3) |
| date      | ISO date  | MUST NOT be in the future at the time it is logged (FR-009)                         |
| createdAt | timestamp |                                                                                     |
| updatedAt | timestamp |                                                                                     |

**Validation**:

- `amount` MUST be non-zero.
- `date` MUST NOT be later than the current date at creation time (FR-009); the UI/domain
  layer rejects such an entry rather than silently clamping it.
- No independent soft-delete (research.md §3); a contribution is either present or directly
  removed.
- Contributions are scoped to, and only ever queried for, a single non-deleted goal — a
  contribution row is never independently listed across goals.

## GoalProgress (derived, not persisted)

The shape the domain engine (`src/domain/savingsGoals/goalProgress.ts`) produces from a
`SavingsGoal` and its `GoalContribution[]`; what the UI and tests consume.

| Field                   | Type                                                        | Notes                                                               |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| goalId                  | UUID                                                        | FK → SavingsGoal                                                    |
| savedAmount             | integer                                                     | Sum of the goal's contribution amounts (FR-003)                     |
| progressPercent         | integer (0-100+, uncapped above 100 on overshoot)           | `round(savedAmount / targetAmount * 100)`                           |
| achieved                | boolean                                                     | `savedAmount >= targetAmount` (FR-004)                              |
| projectedCompletionDate | ISO date, nullable                                          | Per research.md §1; null when insufficient data or already achieved |
| status                  | enum: `achieved`, `insufficient-data`, `behind`, `on-track` | Per research.md §5                                                  |

## Entity Relationship Summary

```
SavingsGoal 1---* GoalContribution
(SavingsGoal + GoalContribution[]) ---> GoalProgress   (derived, in-memory, per goal)
```
