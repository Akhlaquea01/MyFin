import { describe, it, expect } from 'vitest';
import { buildReconciliationPrompt } from '../../src/domain/io/reconciliationPrompt';

// spec 018, User Story 2 (FR-007-FR-011): a static, parameterless prompt so copying it can never
// leak existing transaction/account data — see contracts/reconciliation-prompt.md.
describe('buildReconciliationPrompt', () => {
	it('returns a non-empty string', () => {
		const prompt = buildReconciliationPrompt();
		expect(typeof prompt).toBe('string');
		expect(prompt.length).toBeGreaterThan(0);
	});

	it('specifies the exact column contract ImportPage expects', () => {
		const prompt = buildReconciliationPrompt();
		expect(prompt).toContain('Date,Description,Amount');
	});

	it('specifies an ISO date format', () => {
		const prompt = buildReconciliationPrompt();
		expect(prompt).toContain('YYYY-MM-DD');
	});

	it('instructs negative amounts for debits/expenses', () => {
		const prompt = buildReconciliationPrompt();
		expect(prompt.toLowerCase()).toContain('negative');
	});

	it("never references or requests the user's existing recorded transactions/balances", () => {
		const prompt = buildReconciliationPrompt();
		const lower = prompt.toLowerCase();
		expect(lower).not.toContain('existing transaction');
		expect(lower).not.toContain('current balance');
		expect(lower).not.toContain('your transactions');
	});

	it('takes no arguments — cannot structurally carry transaction data', () => {
		expect(buildReconciliationPrompt.length).toBe(0);
	});
});
