/** The in-memory decision `resolveCategorization()` returns — never persisted as-is. */
export interface CategorizationResult {
	categoryId: string;
	/** Always `[]` for a `source: 'suggestion'` result — learning tracks category only,
	 *  never tags (only an explicit rule can carry tags). */
	tagIds: string[];
	source: 'rule' | 'suggestion';
	/** The rule that produced a `source: 'rule'` result — lets "apply this rule to existing
	 *  transactions" act on exactly the entries that rule decided, not ones a more specific rule
	 *  would have claimed anyway. */
	ruleId?: string;
}
