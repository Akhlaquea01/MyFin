/** The in-memory decision `resolveCategorization()` returns — never persisted as-is. */
export interface CategorizationResult {
	categoryId: string;
	/** Always `[]` for a `source: 'suggestion'` result — learning tracks category only,
	 *  never tags (only an explicit rule can carry tags). */
	tagIds: string[];
	source: 'rule' | 'suggestion';
}
