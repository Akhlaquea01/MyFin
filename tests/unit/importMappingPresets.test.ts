import { describe, it, expect } from 'vitest';
import {
	headerSignature,
	presetFromMapping,
	resolvePreset,
	type ImportColumnChoices
} from '../../src/domain/io/importMappingPresets';

const headers = ['Txn Date', 'Narration', 'Amount', 'Account'];

const single: ImportColumnChoices & { accountId: string } = {
	dateColumn: 'Txn Date',
	amountColumn: 'Amount',
	descriptionColumn: 'Narration',
	accountColumn: undefined,
	accountId: 'acct-1',
	dateFormat: 'DD/MM/YYYY',
	amountSignConvention: 'negative-is-expense'
};

describe('headerSignature', () => {
	it('ignores case, stray spaces and column order', () => {
		expect(headerSignature(['Txn Date', 'Narration', 'Amount'])).toBe(
			headerSignature([' amount', 'NARRATION ', 'txn   date'])
		);
	});

	it('tells layouts apart by their set of headers', () => {
		expect(headerSignature(['Date', 'Amount'])).not.toBe(
			headerSignature(['Date', 'Amount', 'Ref'])
		);
		expect(headerSignature(['Date', 'Amount'])).not.toBe(headerSignature(['Date', 'Debit']));
	});
});

describe('presetFromMapping', () => {
	it('keeps the columns and format but never the destination account', () => {
		const preset = presetFromMapping(headers, single);
		expect(preset).toEqual({
			signature: headerSignature(headers),
			dateColumn: 'Txn Date',
			dateFormat: 'DD/MM/YYYY',
			amountSignConvention: 'negative-is-expense',
			amountColumn: 'Amount',
			debitColumn: null,
			creditColumn: null,
			descriptionColumn: 'Narration',
			accountColumn: null
		});
		expect(JSON.stringify(preset)).not.toContain('acct-1');
	});

	it('drops the columns the chosen convention does not use', () => {
		const preset = presetFromMapping(['Date', 'Withdrawal', 'Deposit', 'Amount'], {
			...single,
			dateColumn: 'Date',
			// A leftover from before the user switched convention must not be remembered.
			amountColumn: 'Amount',
			amountSignConvention: 'separate-debit-credit-columns',
			debitColumn: 'Withdrawal',
			creditColumn: 'Deposit'
		});
		expect(preset.amountColumn).toBeNull();
		expect(preset.debitColumn).toBe('Withdrawal');
		expect(preset.creditColumn).toBe('Deposit');
	});

	it('remembers a per-row account column', () => {
		expect(presetFromMapping(headers, { ...single, accountColumn: 'Account' }).accountColumn).toBe(
			'Account'
		);
	});
});

describe('resolvePreset', () => {
	it('gives back the columns as THIS file spells them', () => {
		const preset = presetFromMapping(headers, single);
		const resolved = resolvePreset(preset, ['TXN DATE', ' narration', 'AMOUNT', 'account']);
		expect(resolved).toMatchObject({
			dateColumn: 'TXN DATE',
			amountColumn: 'AMOUNT',
			descriptionColumn: ' narration',
			dateFormat: 'DD/MM/YYYY',
			amountSignConvention: 'negative-is-expense',
			accountColumn: null
		});
	});

	it('round-trips a debit/credit layout', () => {
		const cols = ['Date', 'Details', 'Withdrawal', 'Deposit'];
		const preset = presetFromMapping(cols, {
			dateColumn: 'Date',
			amountColumn: '',
			descriptionColumn: 'Details',
			dateFormat: 'YYYY-MM-DD',
			amountSignConvention: 'separate-debit-credit-columns',
			debitColumn: 'Withdrawal',
			creditColumn: 'Deposit'
		});
		expect(resolvePreset(preset, cols)).toMatchObject({
			amountSignConvention: 'separate-debit-credit-columns',
			amountColumn: null,
			debitColumn: 'Withdrawal',
			creditColumn: 'Deposit'
		});
	});

	it('is null when a column the preset names is no longer in the file', () => {
		const preset = presetFromMapping(headers, single);
		expect(resolvePreset(preset, ['Txn Date', 'Narration', 'Value', 'Account'])).toBeNull();
		expect(resolvePreset(preset, ['Txn Date', 'Amount', 'Account'])).toBeNull(); // description gone
	});

	it('is null for a preset that is missing what its convention needs', () => {
		const broken = { ...presetFromMapping(headers, single), amountColumn: null };
		expect(resolvePreset(broken, headers)).toBeNull();
		const brokenSplit = {
			...presetFromMapping(headers, single),
			amountSignConvention: 'separate-debit-credit-columns' as const,
			debitColumn: 'Amount',
			creditColumn: null
		};
		expect(resolvePreset(brokenSplit, headers)).toBeNull();
	});

	it('allows a layout with no description column', () => {
		const preset = presetFromMapping(headers, { ...single, descriptionColumn: undefined });
		expect(resolvePreset(preset, headers)).toMatchObject({ descriptionColumn: null });
	});
});
