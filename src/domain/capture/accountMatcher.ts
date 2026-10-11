// Picks the account a captured message belongs to from the digits it mentions ("A/c XX1234",
// "card ending 5678"). Deliberately not `findCardMatches`: that one matches any bare four-digit
// run, which is fine for text the user pasted next to a card nickname but would match "Rs 1234.00"
// to a card ending 1234 here. Only digits the PARSER found after "A/c" or "card" are used.
import type { Account, CaptureInfo, ID } from '../entities';
import type { ParsedCapture } from './captureTypes';

export interface CaptureAccountMatch {
	accountId: ID;
	how: 'tail' | 'card-tail' | 'default';
	accountCheck: CaptureInfo['accountCheck'];
	/** Digits the message mentioned that matched no account — shown to help the user pick. */
	tailHint: string | null;
}

/** Digits match when one ends with the other (three or more digits each), so ICICI's three-digit
 *  tails still find a four-digit tag, and a three-digit tag still finds a four-digit tail. */
function endsWithTail(saved: string | null | undefined, tail: string | null): boolean {
	if (!saved || !tail || saved.length < 3 || tail.length < 3) return false;
	return saved.endsWith(tail) || tail.endsWith(saved);
}

export function matchCaptureAccount(
	parsed: Pick<ParsedCapture, 'accountTail' | 'cardTail'>,
	accounts: Account[],
	defaultAccountId: ID | null
): CaptureAccountMatch | null {
	const active = accounts.filter((a) => !a.isArchived && a.deletedAt === null);

	const byAccountTail = active.filter(
		(a) =>
			endsWithTail(a.accountLast4, parsed.accountTail) ||
			endsWithTail(a.cardLast4, parsed.accountTail)
	);
	const byCardTail = active.filter((a) => endsWithTail(a.cardLast4, parsed.cardTail));

	const tailMatches = byAccountTail.length > 0 ? byAccountTail : byCardTail;
	const how = byAccountTail.length > 0 ? 'tail' : 'card-tail';
	if (tailMatches.length === 1) {
		return { accountId: tailMatches[0].id, how, accountCheck: null, tailHint: null };
	}

	const fallback = defaultAccountId ? active.find((a) => a.id === defaultAccountId) : undefined;
	if (!fallback) return null;

	const mentioned = parsed.accountTail ?? parsed.cardTail;
	if (tailMatches.length > 1) {
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
