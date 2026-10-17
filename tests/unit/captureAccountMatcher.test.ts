import { describe, it, expect } from 'vitest';
import {
	findAccountMatches,
	matchCaptureAccount,
	suggestAccountTag
} from '../../src/domain/capture/accountMatcher';
import type { Account } from '../../src/domain/entities';

function account(id: string, overrides: Partial<Account> = {}): Account {
	return {
		id,
		name: id,
		type: 'bank',
		openingBalance: 0,
		currentBalance: 0,
		creditLimit: null,
		billingCycleDay: null,
		isArchived: false,
		createdAt: 0,
		updatedAt: 0,
		...overrides
	};
}

const tails = (accountTail: string | null, cardTail: string | null = null) => ({
	accountTail,
	cardTail
});

describe('matchCaptureAccount', () => {
	const hdfc = account('hdfc', { accountLast4: '1234' });
	const icici = account('icici', { accountLast4: '9876' });
	const card = account('card', { type: 'credit_card', cardLast4: '5678' });
	const all = [hdfc, icici, card];

	it('picks the one account whose digits the message names', () => {
		expect(matchCaptureAccount(tails('1234'), all, 'icici')).toEqual({
			accountId: 'hdfc',
			how: 'tail',
			accountCheck: null,
			tailHint: null
		});
	});

	it('matches a card by the digits after "card"', () => {
		expect(matchCaptureAccount(tails(null, '5678'), all, 'icici')).toMatchObject({
			accountId: 'card',
			how: 'card-tail',
			accountCheck: null
		});
	});

	it('matches a debit card tagged on a bank account', () => {
		const withDebit = account('hdfc', { accountLast4: '1234', cardLast4: '4321' });
		expect(matchCaptureAccount(tails(null, '4321'), [withDebit], null)?.accountId).toBe('hdfc');
	});

	it('lets a three-digit tail find a four-digit tag, and the reverse', () => {
		expect(matchCaptureAccount(tails('876'), all, null)?.accountId).toBe('icici');
		const threeDigitTag = account('short', { accountLast4: '987' });
		expect(matchCaptureAccount(tails('0987'), [threeDigitTag], null)?.accountId).toBe('short');
	});

	it('falls back to the default account and says the digits matched nothing', () => {
		expect(matchCaptureAccount(tails('0000'), all, 'icici')).toEqual({
			accountId: 'icici',
			how: 'default',
			accountCheck: 'unmatched-tail',
			tailHint: '0000'
		});
	});

	it('falls back to the default account without a hint when the message names no account', () => {
		expect(matchCaptureAccount(tails(null), all, 'icici')).toEqual({
			accountId: 'icici',
			how: 'default',
			accountCheck: 'default-account',
			tailHint: null
		});
	});

	it('does not guess between two accounts that both fit', () => {
		const clash = [account('a', { accountLast4: '1234' }), account('b', { accountLast4: '1234' })];
		expect(matchCaptureAccount(tails('1234'), clash, 'a')).toMatchObject({
			accountId: 'a',
			how: 'default',
			accountCheck: 'default-account'
		});
	});

	it('ignores archived accounts, including as the default', () => {
		const archived = account('old', { accountLast4: '1234', isArchived: true });
		expect(matchCaptureAccount(tails('1234'), [archived, icici], 'icici')).toMatchObject({
			accountId: 'icici',
			accountCheck: 'unmatched-tail'
		});
		expect(matchCaptureAccount(tails('1234'), [archived], 'old')).toBeNull();
	});

	it('returns null when nothing matches and there is no usable default', () => {
		expect(matchCaptureAccount(tails('0000'), all, null)).toBeNull();
		expect(matchCaptureAccount(tails('0000'), all, 'gone')).toBeNull();
	});

	it('prefers the bank account over a card that happens to share the digits', () => {
		const bank = account('bank', { accountLast4: '1234' });
		const sameDigitsCard = account('visa', { type: 'credit_card', cardLast4: '1234' });
		expect(matchCaptureAccount(tails('1234'), [sameDigitsCard, bank], 'visa')).toMatchObject({
			accountId: 'bank',
			how: 'tail',
			accountCheck: null
		});
	});

	it('uses a card tagged with the digits when no bank account carries them', () => {
		const sameDigitsCard = account('visa', { type: 'credit_card', cardLast4: '1234' });
		expect(matchCaptureAccount(tails('1234'), [icici, sameDigitsCard], 'icici')).toMatchObject({
			accountId: 'visa',
			how: 'tail'
		});
	});

	it('prefers the longer overlap when a three-digit and a four-digit tag both fit', () => {
		const short = account('short', { accountLast4: '234' });
		const long = account('long', { accountLast4: '1234' });
		expect(matchCaptureAccount(tails('1234'), [short, long], null)?.accountId).toBe('long');
	});

	it('keeps the digits as a hint when several accounts fit', () => {
		const clash = [account('a', { accountLast4: '1234' }), account('b', { accountLast4: '1234' })];
		expect(matchCaptureAccount(tails('1234'), clash, 'a')?.tailHint).toBe('1234');
	});
});

describe('findAccountMatches', () => {
	const savings = account('savings', { name: 'HDFC Savings', accountLast4: '1234' });
	const card = account('card', { name: 'ICICI Card', type: 'credit_card', cardLast4: '5678' });
	const all = [savings, card];

	it('finds a bank account named after "A/c" and says it is an account', () => {
		expect(findAccountMatches('Rs.500 debited from A/c XX1234 to SWIGGY', all)).toEqual([
			{
				accountId: 'savings',
				accountName: 'HDFC Savings',
				matchedIdentifier: '1234',
				matchType: 'account'
			}
		]);
	});

	it('finds a masked number with no "A/c" in front of it', () => {
		expect(
			findAccountMatches('Rs.500 debited from HDFC Bank XX1234', all).map((m) => m.accountId)
		).toEqual(['savings']);
	});

	it('keeps the credit-card match as a card match and does not list it twice', () => {
		const matches = findAccountMatches('Spent Rs.500 on card ending 5678', all);
		expect(matches).toHaveLength(1);
		expect(matches[0]).toMatchObject({ accountId: 'card', matchType: 'last4' });
	});

	it('returns both when the message names an account and a card', () => {
		const matches = findAccountMatches('Rs.500 from A/c XX1234 on card ending 5678', all);
		expect(matches.map((m) => m.accountId).sort()).toEqual(['card', 'savings']);
	});

	it('never reads an amount as an account number', () => {
		expect(findAccountMatches('Paid Rs 1234.00 to SWIGGY', all)).toEqual([]);
	});

	it('ignores archived accounts', () => {
		const archived = account('old', { accountLast4: '1234', isArchived: true });
		expect(findAccountMatches('debited from A/c XX1234', [archived])).toEqual([]);
	});
});

describe('matchCaptureAccount — credit-card messages the digits cannot settle', () => {
	const bank = account('bank', { accountLast4: '1234' });
	const onlyCard = account('card', { type: 'credit_card' });
	const creditCard = { instrument: 'credit_card' as const, isCardPayment: false };

	it('files a "credit card" message on the only credit-card account, flagged', () => {
		expect(
			matchCaptureAccount({ ...tails(null), ...creditCard }, [bank, onlyCard], 'bank')
		).toEqual({
			accountId: 'card',
			how: 'card-type',
			accountCheck: 'card-type-guess',
			tailHint: null
		});
	});

	it('does so even when the card was never tagged and the message names digits', () => {
		expect(
			matchCaptureAccount({ ...tails(null, '9999'), ...creditCard }, [bank, onlyCard], 'bank')
		).toMatchObject({ accountId: 'card', accountCheck: 'card-type-guess', tailHint: '9999' });
	});

	it('works for a user whose only account is the card, with no default chosen', () => {
		expect(
			matchCaptureAccount({ ...tails(null), ...creditCard }, [onlyCard], null)?.accountId
		).toBe('card');
	});

	it('still prefers the digits when they name a card', () => {
		const tagged = account('tagged', { type: 'credit_card', cardLast4: '5678' });
		expect(
			matchCaptureAccount(
				{ ...tails(null, '5678'), ...creditCard },
				[bank, onlyCard, tagged],
				'bank'
			)
		).toMatchObject({ accountId: 'tagged', how: 'card-tail', accountCheck: null });
	});

	it('does not guess between two credit cards', () => {
		const second = account('second', { type: 'credit_card' });
		expect(
			matchCaptureAccount({ ...tails(null), ...creditCard }, [bank, onlyCard, second], 'bank')
		).toMatchObject({ accountId: 'bank', accountCheck: 'default-account' });
	});

	it('does not file a card with different saved digits: that is probably another card', () => {
		const tagged = account('tagged', { type: 'credit_card', cardLast4: '5678' });
		expect(
			matchCaptureAccount({ ...tails(null, '9999'), ...creditCard }, [bank, tagged], 'bank')
		).toMatchObject({ accountId: 'bank', accountCheck: 'unmatched-tail', tailHint: '9999' });
	});

	it('leaves a bank debit for a card bill on the bank account', () => {
		expect(
			matchCaptureAccount(
				{ ...tails('0000'), instrument: 'credit_card', isCardPayment: true },
				[bank, onlyCard],
				'bank'
			)
		).toMatchObject({ accountId: 'bank' });
		expect(
			matchCaptureAccount({ ...tails('0000'), ...creditCard }, [bank, onlyCard], 'bank')
		).toMatchObject({ accountId: 'bank' });
	});

	it('ignores the card hint when the message does not say credit card', () => {
		expect(matchCaptureAccount(tails(null), [bank, onlyCard], 'bank')).toMatchObject({
			accountId: 'bank',
			accountCheck: 'default-account'
		});
	});
});

describe('suggestAccountTag', () => {
	it('offers the card digits for an untagged credit card', () => {
		const card = account('card', { type: 'credit_card' });
		expect(
			suggestAccountTag('Rs.500 spent on your Credit Card ending 5678 at AMAZON', card)
		).toEqual({ field: 'cardLast4', digits: '5678' });
	});

	it('offers the account digits for an untagged bank account', () => {
		expect(suggestAccountTag('Rs.500 debited from A/c XX1234 to SWIGGY', account('bank'))).toEqual({
			field: 'accountLast4',
			digits: '1234'
		});
	});

	it('offers nothing when the account already carries that tag or the message names none', () => {
		const tagged = account('card', { type: 'credit_card', cardLast4: '1111' });
		expect(suggestAccountTag('Rs.500 spent on Credit Card ending 5678', tagged)).toBeNull();
		expect(suggestAccountTag('Paid Rs 250 to Swiggy', account('bank'))).toBeNull();
	});
});
