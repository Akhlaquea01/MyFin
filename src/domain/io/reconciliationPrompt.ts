// spec 018, User Story 2 (FR-007-FR-011): a fixed, parameterless prompt for reconciling a bank/
// card statement via an external AI tool, without ever exporting this app's encrypted data as
// plaintext. Pure — no I/O, same layer as cardIdentifierMatcher.ts/merchantResolver.ts. Taking no
// arguments is the structural guarantee that it can never carry existing transaction/account data
// (FR-008) — see contracts/reconciliation-prompt.md.

export function buildReconciliationPrompt(): string {
	return [
		"I'm going to paste a bank or credit card statement below this message. Read every " +
			'transaction line in it and reply with ONLY a CSV (no markdown code fence, no ' +
			'commentary before or after) that I can save directly as a .csv file.',
		'',
		'The CSV must use exactly this format:',
		'- Header row: Date,Description,Amount',
		'- Date: YYYY-MM-DD (e.g. 2026-01-15)',
		'- Description: whatever line-item text the statement shows (merchant, memo, reference)',
		'- Amount: a plain decimal number, negative for money leaving the account ' +
			'(debits/expenses/purchases) and positive for money coming in (credits/income/refunds) ' +
			'— e.g. -1234.56 or 500.00',
		'',
		'One row per transaction found in the statement. Do not summarize, group, or skip any row.',
		'',
		'I will paste my statement text right after this — do not ask me for anything else first. ' +
			'You only need the statement text/pdf/xlxs itself to produce the CSV.'
	].join('\n');
}
