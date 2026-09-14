import type { Account } from '../entities';

export type CardMatchType = 'last4' | 'nickname';

export interface CardMatch {
	accountId: string;
	accountName: string;
	matchedIdentifier: string;
	matchType: CardMatchType;
}

/**
 * Scans `text` for any tagged credit-card identifier (last-4 digits and/or nickname) belonging
 * to `accounts` (spec 017, FR-019/FR-020). Pure text matching — no bank-specific statement
 * parsing (spec Assumptions). Used both at the file/paste level (pre-select a destination,
 * disambiguate when >1 match) and per-row/per-line (mixed-statement routing) — see
 * contracts/card-identifier-matching.md.
 */
export function findCardMatches(text: string, accounts: Account[]): CardMatch[] {
	if (!text) return [];

	const matches: CardMatch[] = [];
	for (const account of accounts) {
		if (account.type !== 'credit_card') continue;

		// Preferred signal: a standalone 4-digit group, not part of a longer digit run (e.g. a
		// 16-digit masked PAN that happens to contain the same 4 digits mid-string). The
		// `/^\d{4}$/` guard also keeps this a safe literal to interpolate into the RegExp below.
		if (account.cardLast4 && /^\d{4}$/.test(account.cardLast4)) {
			const pattern = new RegExp(`(?<!\\d)${account.cardLast4}(?!\\d)`);
			if (pattern.test(text)) {
				matches.push({
					accountId: account.id,
					accountName: account.name,
					matchedIdentifier: account.cardLast4,
					matchType: 'last4'
				});
				continue; // an account matching by both signals counts once, preferring last4
			}
		}

		if (account.cardNickname && account.cardNickname.trim()) {
			const nickname = account.cardNickname.trim();
			if (text.toLowerCase().includes(nickname.toLowerCase())) {
				matches.push({
					accountId: account.id,
					accountName: account.name,
					matchedIdentifier: nickname,
					matchType: 'nickname'
				});
			}
		}
	}
	return matches;
}
