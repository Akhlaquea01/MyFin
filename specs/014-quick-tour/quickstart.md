# Quickstart & Validation: Quick Tour

## Validation Scenarios

### Scenario 1: First-time Auto-Start
1. **Prerequisites**: Clear site data / `localStorage` to simulate a fresh install. Ensure the IndexedDB is empty (no accounts or transactions).
2. **Action**: Complete the initial PIN setup.
3. **Expected Outcome**: The Quick Tour automatically appears on the main screen immediately following the setup, starting at step 1.

### Scenario 2: Skipping the Tour
1. **Prerequisites**: Trigger the tour (via Scenario 1 or manual replay).
2. **Action**: Click "Skip Tour", press the `Escape` key, or click the close (X) button.
3. **Expected Outcome**: The tour immediately closes. If this was the first-time auto-start, `APP_QUICK_TOUR_SEEN` in `localStorage` is set to `true`. Full interaction with the app is restored without being trapped.

### Scenario 3: Manual Replay
1. **Prerequisites**: The app is unlocked. The user may or may not have existing data.
2. **Action**: Navigate to the App Settings / Help page and click "Replay Quick Tour".
3. **Expected Outcome**: The tour starts from Step 1 and behaves identically to the first-time experience, highlighting the main app areas. The user can skip or complete it normally.

### Scenario 4: Existing User No Auto-Start
1. **Prerequisites**: Ensure the app has existing financial data (e.g., restore a backup or add a transaction). Remove `APP_QUICK_TOUR_SEEN` from `localStorage`.
2. **Action**: Reload the app and unlock it.
3. **Expected Outcome**: The tour is **NOT** automatically offered, because the user has existing data.
