# Data Model: Quick Tour

## Entities

### `TourPreference` (Client-Side State)
A simple key-value stored in the browser's `localStorage` to track if the automatic first-time tour has been shown or dismissed.

- **Key**: `APP_QUICK_TOUR_SEEN`
- **Value**: `"true"` or `"false"` (if not set, implicitly false)
- **Validation**: 
  - If missing or `"false"`, the tour is eligible to automatically start if the user has no existing financial data (e.g., right after initial PIN setup).
  - If `"true"`, the tour is NEVER automatically started (satisfying FR-004).
- **Scope**: Per-installation (browser profile). It does not sync, and it is independent of the encrypted financial data in Dexie.
