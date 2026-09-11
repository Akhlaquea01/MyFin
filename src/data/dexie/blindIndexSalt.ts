import { UserProfileRepository } from './userProfileRepository';

/**
 * Supplies the per-installation salt that `blindIndex` mixes into every searchable digest.
 *
 * The profile's `encryptionSalt` is reused rather than introducing a second salt: it is
 * already random per installation, already stored alongside the data, and a separate value
 * would add a migration without changing what an attacker holding the profile can do (they
 * would hold both salts either way). What it buys is that digests are not comparable across
 * devices, so no precomputed table of common merchant names is reusable.
 *
 * Cached because it is read on every alias and tag lookup and never changes within a session.
 * A restore replaces the profile and then reloads the page, which clears this naturally.
 */
let cachedSalt: string | null = null;

export async function getBlindIndexSalt(): Promise<string> {
	if (cachedSalt !== null) return cachedSalt;
	const profile = await UserProfileRepository.get();
	// Before onboarding completes there is no profile. An empty salt still produces a stable,
	// self-consistent digest, and the only rows that could be written in that window would be
	// re-indexed by the maintenance pass anyway.
	cachedSalt = profile?.encryptionSalt ?? '';
	return cachedSalt;
}

/** Clears the cache. Exported for tests, which swap databases between cases. */
export function resetBlindIndexSaltCache(): void {
	cachedSalt = null;
}
