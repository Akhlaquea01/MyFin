// Picks the account a captured message belongs to from the digits it mentions ("A/c XX1234",
// "card ending 5678"). Deliberately not `findCardMatches` alone: that one matches any bare four-digit
// run, which is fine for text the user pasted next to a card nickname but would match "Rs 1234.00"
// to a card ending 1234 here. Only digits the PARSER found after "A/c" or "card" (or behind a mask)
// are used.
import type { Account, CaptureInfo, ID } from '../entities';
import { findCardMatches, type CardMatch } from '../parser/cardIdentifierMatcher';
import { extractAccountTails } from './captureParser';
import type { ParsedCapture } from './captureTypes';

export interface CaptureAccountMatch {
	accountId: ID;
	how: 'tail' | 'card-tail' | 'default';
	accountCheck: CaptureInfo['accountCheck'];
	/** Digits the message mentioned that matched no account — shown to help the user pick. */
	tailHint: string | null;
}

/** How many trailing digits two tags share when one ends with the other (three or more digits
 *  each), so ICICI's three-digit tails still find a four-digit tag, and a three-digit tag still
 *  finds a four-digit tail. Zero means no match. */
function tailOverlap(saved: string | null | undefined, tail: string | null | undefined): number {
	if (!saved || !tail || saved.length < 3 || tail.length < 3) return 0;
	return saved.endsWith(tail) || tail.endsWith(saved) ? Math.min(saved.length, tail.length) : 0;
}

/** The accounts sharing the longest overlap, so a four-digit tag beats a three-digit one. */
function longestOverlap(scored: { account: Account; overlap: number }[]): Account[] {
	const top = Math.max(0, ...scored.map((s) => s.overlap));
	return top === 0 ? [] : scored.filter((s) => s.overlap === top).map((s) => s.account);
}

export function matchCaptureAccount(
	parsed: Pick<ParsedCapture, 'accountTail' | 'cardTail'>,
	accounts: Account[],
	defaultAccountId: ID | null
): CaptureAccountMatch | null {
	const active = accounts.filter((a) => !a.isArchived);

	// "A/c XX1234" names a bank account first; only when none carries those digits is a card
	// tagged with them considered, then the digits after "card".
	const tiers: { matches: Account[]; how: 'tail' | 'card-tail' }[] = [
		{
			matches: longestOverlap(
				active.map((a) => ({
					account: a,
					overlap: tailOverlap(a.accountLast4, parsed.accountTail)
				}))
			),
			how: 'tail'
		},
		{
			matches: longestOverlap(
				active.map((a) => ({ account: a, overlap: tailOverlap(a.cardLast4, parsed.accountTail) }))
			),
			how: 'tail'
		},
		{
			matches: longestOverlap(
				active.map((a) => ({ account: a, overlap: tailOverlap(a.cardLast4, parsed.cardTail) }))
			),
			how: 'card-tail'
		}
	];
	const hit = tiers.find((tier) => tier.matches.length > 0);
	if (hit?.matches.length === 1) {
		return { accountId: hit.matches[0].id, how: hit.how, accountCheck: null, tailHint: null };
	}

	const fallback = defaultAccountId ? active.find((a) => a.id === defaultAccountId) : undefined;
	if (!fallback) return null;

	const mentioned = parsed.accountTail ?? parsed.cardTail;
	if (hit) {
		return {
			accountId: fallback.id,
			how: 'default',
			accountCheck: 'default-account',
			tailHint: mentioned
		};
	}
	return {
		accountId: fallback.id,
		how: 'default',
		// Nothing in the message pointed at an account at all, versus digits that matched none.
		accountCheck: mentioned ? 'unmatched-tail' : 'default-account',
		tailHint: mentioned
	};
}

/**
 * Accounts a pasted or imported text points at: tagged credit cards (`findCardMatches`) plus any
 * account whose saved digits the text names after "A/c" or "card". Same shape as `findCardMatches`,
 * so Quick Add and the import screens keep their one-match-selects / several-prompt behaviour.
 */
export function findAccountMatches(text: string, accounts: Account[]): CardMatch[] {
	const matches = findCardMatches(text, accounts);
	const { accountTail, cardTail } = extractAccountTails(text);
	if (!accountTail && !cardTail) return matches;

	const seen = new Set(matches.map((m) => m.accountId));
	for (const account of accounts) {
		if (seen.has(account.id) || account.isArchived) continue;
		const tag = [
			[account.accountLast4, accountTail],
			[account.cardLast4, accountTail],
			[account.cardLast4, cardTail]
		].find(([saved, tail]) => tailOverlap(saved, tail) > 0)?.[0];
		if (!tag) continue;
		matches.push({
			accountId: account.id,
			accountName: account.name,
			matchedIdentifier: tag,
			matchType: 'account'
		});
	}
	return matches;
}
