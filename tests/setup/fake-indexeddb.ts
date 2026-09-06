// Provides a real IndexedDB implementation inside Vitest's Node environment so
// Dexie-backed repository/integration tests run without a browser.
import 'fake-indexeddb/auto';
