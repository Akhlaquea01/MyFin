# Research: Guided Quick Tour

## Technical Clarifications

### 1. Tour Rendering and Highlighting Approach
- **Decision**: Build a custom React `QuickTourOverlay` component using absolute positioning and `getBoundingClientRect()` to highlight target elements, leveraging existing `shadcn/ui` and Radix primitives where appropriate.
- **Rationale**: The spec strictly requires the tour to NOT trap focus (FR-007) and to be a simple, fixed linear sequence (Assumption 1). Using a custom lightweight overlay avoids adding heavy 3rd-party dependencies (like `react-joyride` or `driver.js`) while ensuring full control over the specific non-blocking accessibility requirements.
- **Alternatives considered**: `react-joyride`, `driver.js`. Rejected because they often enforce focus trapping, add unnecessary bundle weight, and may conflict with our strict local-first, zero-server UI components if they rely on external assets.

### 2. Tour State Persistence
- **Decision**: Store the `QUICK_TOUR_SEEN` boolean in the browser's `localStorage`.
- **Rationale**: This is a non-sensitive, per-installation preference (Key Entities: Tour Preference). `localStorage` is already established in the codebase for similar non-sensitive device preferences (e.g., `AUTO_BACKUP_KEY`), making it a consistent, synchronous, and lightweight choice.
- **Alternatives considered**: Storing in the encrypted Dexie database. Rejected because the tour preference is not sensitive financial data and does not require encryption.

### 3. Detecting "First-time user with no existing data"
- **Decision**: Upon successful PIN setup, check if the `accounts` or `transactions` tables in the Dexie DB are empty. If they are, auto-start the tour.
- **Rationale**: The spec explicitly states: "tied to 'no existing financial data yet', using the same signal already available from the onboarding/PIN-setup flow" (Assumptions).
- **Alternatives considered**: Adding a dedicated `is_new_user` flag. Rejected because it contradicts the spec's assumptions and adds unnecessary state management.
