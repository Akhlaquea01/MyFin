/**
 * Pure query/matching logic for tag-based filtering and search (spec 012). No I/O, no
 * `CryptoKey`, no Dexie import — every function here takes already-loaded, already-decrypted
 * data and returns a plain result. See specs/012-tag-filtering-search/contracts/tag-filter-engine.md.
 */

/** A tag as presented to the filter pick-list — a thin, decrypted projection of `Tag`. */
export interface TagOption {
	id: string;
	name: string;
}

/**
 * Matches spec FR-002's "any of the selected tags" (OR) rule. An empty `selectedTagIds`
 * means no tag filter is active, so nothing is excluded by it.
 */
export function matchesAnyTag(transactionTagIds: string[], selectedTagIds: string[]): boolean {
	if (selectedTagIds.length === 0) return true;
	return transactionTagIds.some((id) => selectedTagIds.includes(id));
}

/**
 * The single normalization every tag-name comparison below uses, so pick-list narrowing and
 * free-text tag matching can't silently drift apart (FR-007).
 */
export function normalizeTagText(value: string): string {
	return value.trim().toLowerCase();
}

/** Empty `query` matches everything — the full pick-list shows when nothing has been typed. */
export function tagNameMatchesQuery(name: string, query: string): boolean {
	return normalizeTagText(name).includes(normalizeTagText(query));
}

/** Narrows a pick-list as the user types (FR-005); preserves the input order. */
export function filterTagOptions(options: TagOption[], query: string): TagOption[] {
	return options.filter((option) => tagNameMatchesQuery(option.name, query));
}

/**
 * The set of tag ids referenced by at least one live (non-deleted) transaction (FR-009). A tag
 * referenced only by a soft-deleted transaction is excluded; one referenced by both a live and
 * a deleted transaction is included, since any live reference is enough.
 */
export function distinctTagIdsInUse(
	transactionTagRows: { transactionId: string; tagId: string }[],
	liveTransactionIds: Set<string>
): Set<string> {
	const result = new Set<string>();
	for (const row of transactionTagRows) {
		if (liveTransactionIds.has(row.transactionId)) result.add(row.tagId);
	}
	return result;
}

/**
 * Extends the existing notes-only free-text match to also check a transaction's tag names
 * (FR-006). `needle` is assumed already-normalized (the caller normalizes once, not per
 * transaction) — same discipline `search()` already applies to `freeText` before comparing it
 * against `notes`.
 */
export function transactionMatchesFreeText(
	notes: string | null,
	tagNames: string[],
	needle: string
): boolean {
	if (normalizeTagText(notes ?? '').includes(needle)) return true;
	return tagNames.some((name) => normalizeTagText(name).includes(needle));
}
