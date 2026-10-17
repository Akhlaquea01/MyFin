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
	how: 'tail' | 'card-tail' | 'card-type' | 'default';
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

type MatchInput = Pick<ParsedCapture, 'accountTail' | 'cardTail'> &
	Partial<Pick<ParsedCapture, 'instrument' | 'isCardPayment'>>;

/**
 * The one credit-card account a "Credit Card" message can only be about, when the digits did not
 * settle it. Refuses to guess when the message names a bank account, is about paying the bill
 * (that debit belongs to the bank account), or names card digits that a differently-tagged card
 * does not share — that is probably a card the user has not added.
 */
function soleCreditCard(parsed: MatchInput, active: Account[]): Account | null {
	if (parsed.instrument !== 'credit_card' || parsed.isCardPayment) return null;
	if (parsed.accountTail && !parsed.cardTail) return null;
	const cards = active.filter((a) => a.type === 'credit_card');
	if (cards.length !== 1) return null;
	const [card] = cards;
	if (parsed.cardTail && card.cardLast4 && tailOverlap(card.cardLast4, parsed.cardTail) === 0) {
		return null;
	}
	return card;
}

export function matchCaptureAccount(
	parsed: MatchInput,
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

	const mentioned = parsed.accountTail ?? parsed.cardTail;

	// The digits settled nothing, but "Credit Card" plus a single credit-card account does: better
	// there (flagged for a look) than on the default bank account, which would be debited for it.
	if (!hit) {
		const card = soleCreditCard(parsed, active);
		if (card) {
			return {
				accountId: card.id,
				how: 'card-type',
				accountCheck: 'card-type-guess',
				tailHint: mentioned
			};
		}
	}

	const fallback = defaultAccountId ? active.find((a) => a.id === defaultAccountId) : undefined;
	if (!fallback) return null;

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
 * After the user moves a captured entry to `account`, the digits worth offering to save on it so
 * the next message about the same account or card files there by itself. Null when the message
 * gave none, or the account already carries that kind of tag.
 */
export function suggestAccountTag(
	messageText: string,
	account: Account
): { field: 'cardLast4' | 'accountLast4'; digits: string } | null {
	const { accountTail, cardTail } = extractAccountTails(messageText);
	if (account.type === 'credit_card') {
		const digits = cardTail ?? accountTail;
		return digits && digits.length === 4 && !account.cardLast4
			? { field: 'cardLast4', digits }
			: null;
	}
	if (accountTail && !account.accountLast4) return { field: 'accountLast4', digits: accountTail };
	if (cardTail && cardTail.length === 4 && !account.cardLast4) {
		return { field: 'cardLast4', digits: cardTail };
	}
	return null;
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
