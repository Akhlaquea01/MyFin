import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID
} from '../../src/data/dexie/transactionRepository';
import { PersonRepository, PersonLoanRepository } from '../../src/data/dexie/personLoanRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { categoryBreakdown } from '../../src/domain/analytics/analyticsEngine';
import { importRows, type ColumnMapping } from '../../src/data/io/importService';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';
import type { Account } from '../../src/domain/entities';

// Credit card bill payments and transfers: ONE movement of money recorded as two linked legs.
describe('transfer and card-payment engine', () => {
	let key: CryptoKey;
	let bank: Account;
	let card: Account;

	async function balanceOf(id: string): Promise<number> {
		return (await AccountRepository.getById(key, id))!.currentBalance;
	}

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('1357', randomSaltBase64());
		bank = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 100_000,
			creditLimit: null,
			billingCycleDay: null
		});
		// A card is stored as a NEGATIVE balance: -40,000 means 400.00 is owed.
		card = await AccountRepository.create(key, {
			name: 'HDFC Card',
			type: 'credit_card',
			openingBalance: -40_000,
			creditLimit: 500_000,
			billingCycleDay: null,
			cardLast4: '1234'
		});
	});

	describe('paying a card bill', () => {
		it('one payment debits the bank and reduces what is owed on the card', async () => {
			await TransactionEngine.recordTransfer(key, {
				fromAccountId: bank.id,
				toAccountId: card.id,
				amount: 15_000,
				date: '2026-03-10'
			});
			expect(await balanceOf(bank.id)).toBe(85_000);
			expect(await balanceOf(card.id)).toBe(-25_000);
		});
	});

	describe('deleting and restoring a transfer', () => {
		it('deleting either leg moves BOTH to trash and restores both balances', async () => {
			const [out, into] = await TransactionEngine.recordTransfer(key, {
				fromAccountId: bank.id,
				toAccountId: card.id,
				amount: 15_000,
				date: '2026-03-10'
			});

			// Delete the *card* leg: the bank leg must go with it, not stay behind.
			await TransactionEngine.deleteTransaction(key, into.id);
			expect((await TransactionRepository.getById(key, out.id))?.deletedAt).not.toBeNull();
			expect((await TransactionRepository.getById(key, into.id))?.deletedAt).not.toBeNull();
			expect(await balanceOf(bank.id)).toBe(100_000);
			expect(await balanceOf(card.id)).toBe(-40_000);
			expect(await TransactionRepository.search(key, {})).toHaveLength(0);
		});

		it('restoring either leg brings the whole transfer back', async () => {
			const [out, into] = await TransactionEngine.recordTransfer(key, {
				fromAccountId: bank.id,
				toAccountId: card.id,
				amount: 15_000,
				date: '2026-03-10'
			});
			await TransactionEngine.deleteTransaction(key, out.id);
			await TransactionEngine.restoreTransaction(key, out.id);

			expect((await TransactionRepository.getById(key, into.id))?.deletedAt).toBeNull();
			expect(await balanceOf(bank.id)).toBe(85_000);
			expect(await balanceOf(card.id)).toBe(-25_000);
		});

		it('permanently purging one leg purges the other too, so no orphaned half-transfer survives', async () => {
			const [out, into] = await TransactionEngine.recordTransfer(key, {
				fromAccountId: bank.id,
				toAccountId: card.id,
				amount: 15_000,
				date: '2026-03-10'
			});
			await TransactionEngine.deleteTransaction(key, out.id);
			await TransactionRepository.purge(key, out.id);

			expect(await TransactionRepository.getById(key, out.id)).toBeNull();
			expect(await TransactionRepository.getById(key, into.id)).toBeNull();
			expect(await TransactionRepository.getSplits(key, into.id)).toEqual([]);
			expect(await balanceOf(bank.id)).toBe(100_000);
			expect(await balanceOf(card.id)).toBe(-40_000);
		});

		it('deleting an ordinary transaction is unchanged', async () => {
			const tx = await TransactionEngine.recordTransaction(key, {
				accountId: bank.id,
				date: '2026-03-10',
				amount: -5_000,
				type: 'expense'
			});
			await TransactionEngine.deleteTransaction(key, tx.id);
			expect(await balanceOf(bank.id)).toBe(100_000);
			await TransactionEngine.restoreTransaction(key, tx.id);
			expect(await balanceOf(bank.id)).toBe(95_000);
		});
	});

	describe('convertToTransfer', () => {
		it('turns a plain expense into a transfer by creating the missing leg on the card', async () => {
			// The mistake this fixes: a card bill payment recorded as an ordinary expense.
			const expense = await TransactionEngine.recordTransaction(
				key,
				{
					accountId: bank.id,
					date: '2026-03-10',
					amount: -15_000,
					type: 'expense',
					notes: 'CREDIT CARD PAYMENT 1234'
				},
				[{ categoryId: 'some-category', amount: -15_000 }]
			);
			expect(await balanceOf(card.id)).toBe(-40_000); // untouched: the card thinks it's unpaid

			const [converted, counterpart] = await TransactionEngine.convertToTransfer(key, expense.id, {
				accountId: card.id
			});

			expect(converted.type).toBe('transfer');
			expect(converted.transferPairId).toBe(counterpart.id);
			expect(counterpart.transferPairId).toBe(converted.id);
			expect(counterpart.accountId).toBe(card.id);
			expect(counterpart.amount).toBe(15_000);
			expect(counterpart.date).toBe('2026-03-10');
			expect(counterpart.type).toBe('transfer');

			// Bank unchanged (already debited), card now owes 15,000 less.
			expect(await balanceOf(bank.id)).toBe(85_000);
			expect(await balanceOf(card.id)).toBe(-25_000);

			// A transfer carries no category on either leg.
			for (const leg of [converted, counterpart]) {
				const splits = await TransactionRepository.getSplits(key, leg.id);
				expect(splits).toHaveLength(1);
				expect(splits[0].categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
				expect(splits[0].amount).toBe(leg.amount);
			}
		});

		it('links to the matching entry already on the other account instead of duplicating it', async () => {
			// Both statements were imported: the bank debit and the card "payment received" credit.
			const bankDebit = await TransactionEngine.recordTransaction(key, {
				accountId: bank.id,
				date: '2026-03-10',
				amount: -15_000,
				type: 'expense',
				source: 'file_import',
				reviewStatus: 'unreviewed'
			});
			const cardCredit = await TransactionEngine.recordTransaction(key, {
				accountId: card.id,
				date: '2026-03-12',
				amount: 15_000,
				type: 'income',
				source: 'file_import',
				reviewStatus: 'unreviewed'
			});
			const balancesBefore = [await balanceOf(bank.id), await balanceOf(card.id)];

			const candidates = await TransactionEngine.findTransferCandidates(key, bankDebit.id);
			expect(candidates.map((c) => c.id)).toEqual([cardCredit.id]);

			await TransactionEngine.convertToTransfer(key, bankDebit.id, {
				transactionId: cardCredit.id
			});

			// No new rows, no balance change — just the two existing entries now linked.
			expect(await TransactionRepository.search(key, {})).toHaveLength(2);
			expect([await balanceOf(bank.id), await balanceOf(card.id)]).toEqual(balancesBefore);
			const a = (await TransactionRepository.getById(key, bankDebit.id))!;
			const b = (await TransactionRepository.getById(key, cardCredit.id))!;
			expect(a.transferPairId).toBe(b.id);
			expect(b.transferPairId).toBe(a.id);
			expect(a.type).toBe('transfer');
			expect(b.type).toBe('transfer');
			expect(a.reviewStatus).toBe('confirmed');
			expect(b.reviewStatus).toBe('confirmed');
		});

		it('only offers candidates with the opposite amount, on another account, within the window', async () => {
			const debit = await TransactionEngine.recordTransaction(key, {
				accountId: bank.id,
				date: '2026-03-10',
				amount: -15_000,
				type: 'expense'
			});
			const match = await TransactionEngine.recordTransaction(key, {
				accountId: card.id,
				date: '2026-03-11',
				amount: 15_000,
				type: 'income'
			});
			// Wrong amount, too far away, same account, same direction: none of these qualify.
			await TransactionEngine.recordTransaction(key, {
				accountId: card.id,
				date: '2026-03-11',
				amount: 14_999,
				type: 'income'
			});
			await TransactionEngine.recordTransaction(key, {
				accountId: card.id,
				date: '2026-03-20',
				amount: 15_000,
				type: 'income'
			});
			await TransactionEngine.recordTransaction(key, {
				accountId: bank.id,
				date: '2026-03-10',
				amount: 15_000,
				type: 'income'
			});
			await TransactionEngine.recordTransaction(key, {
				accountId: card.id,
				date: '2026-03-10',
				amount: -15_000,
				type: 'expense'
			});

			const candidates = await TransactionEngine.findTransferCandidates(key, debit.id);
			expect(candidates.map((c) => c.id)).toEqual([match.id]);
		});

		it('refuses a transaction that is already a transfer', async () => {
			const [out] = await TransactionEngine.recordTransfer(key, {
				fromAccountId: bank.id,
				toAccountId: card.id,
				amount: 1_000,
				date: '2026-03-10'
			});
			await expect(
				TransactionEngine.convertToTransfer(key, out.id, { accountId: card.id })
			).rejects.toThrow(/already part of a transfer|loan or repayment/);
		});

		it('refuses to convert onto the same account, or to link a mismatched amount', async () => {
			const expense = await TransactionEngine.recordTransaction(key, {
				accountId: bank.id,
				date: '2026-03-10',
				amount: -15_000,
				type: 'expense'
			});
			await expect(
				TransactionEngine.convertToTransfer(key, expense.id, { accountId: bank.id })
			).rejects.toThrow(/two different accounts/);

			const wrongAmount = await TransactionEngine.recordTransaction(key, {
				accountId: card.id,
				date: '2026-03-10',
				amount: 9_999,
				type: 'income'
			});
			await expect(
				TransactionEngine.convertToTransfer(key, expense.id, { transactionId: wrongAmount.id })
			).rejects.toThrow(/same amount in the opposite direction/);
			// Nothing was half-applied.
			expect((await TransactionRepository.getById(key, expense.id))?.type).toBe('expense');
		});

		it('refuses the ledger movement behind a person loan — that is managed from People', async () => {
			const person = await PersonRepository.create(key, { name: 'Asha' });
			const loan = await PersonLoanRepository.create(key, {
				personId: person.id,
				direction: 'lent',
				principalAmount: 5_000,
				date: '2026-03-10',
				dueDate: null,
				notes: null,
				accountId: bank.id
			});
			await expect(
				TransactionEngine.convertToTransfer(key, loan.transactionId, { accountId: card.id })
			).rejects.toThrow(/loan or repayment/);
			expect(await TransactionRepository.getLoanLink(key, loan.transactionId)).toEqual({
				kind: 'loan',
				loanId: loan.id
			});
		});
	});

	describe('editTransferPair', () => {
		it('applies date, amount and notes to both legs and rebalances both accounts', async () => {
			const [out, into] = await TransactionEngine.recordTransfer(key, {
				fromAccountId: bank.id,
				toAccountId: card.id,
				amount: 15_000,
				date: '2026-03-10'
			});
			// Edit via the CARD leg to prove which leg is chosen doesn't matter.
			await TransactionEngine.editTransferPair(key, into.id, {
				amount: 20_000,
				date: '2026-03-11',
				notes: 'March bill'
			});

			const a = (await TransactionRepository.getById(key, out.id))!;
			const b = (await TransactionRepository.getById(key, into.id))!;
			expect(a.amount).toBe(-20_000);
			expect(b.amount).toBe(20_000);
			expect(a.date).toBe('2026-03-11');
			expect(b.date).toBe('2026-03-11');
			expect(a.notes).toBe('March bill');
			expect(b.notes).toBe('March bill');
			expect(await balanceOf(bank.id)).toBe(80_000);
			expect(await balanceOf(card.id)).toBe(-20_000);
		});

		it('rejects a non-positive amount and leaves both legs alone', async () => {
			const [out] = await TransactionEngine.recordTransfer(key, {
				fromAccountId: bank.id,
				toAccountId: card.id,
				amount: 15_000,
				date: '2026-03-10'
			});
			await expect(TransactionEngine.editTransferPair(key, out.id, { amount: 0 })).rejects.toThrow(
				/positive/
			);
			expect((await TransactionRepository.getById(key, out.id))?.amount).toBe(-15_000);
		});
	});

	describe('TransactionRepository.writeAtomic', () => {
		it('writes nothing if a split sum is wrong', async () => {
			const tx = await TransactionEngine.recordTransaction(key, {
				accountId: bank.id,
				date: '2026-03-10',
				amount: -5_000,
				type: 'expense'
			});
			await expect(
				TransactionRepository.writeAtomic(key, [
					{
						transaction: { ...tx, notes: 'changed' },
						splits: [{ categoryId: 'x', amount: -1 }]
					}
				])
			).rejects.toThrow(/must sum to the transaction amount/);
			expect((await TransactionRepository.getById(key, tx.id))?.notes).toBeNull();
		});
	});

	describe('reports', () => {
		it('a card payment is not counted as spending in the category breakdown', async () => {
			const groceries = await CategoryRepository.create(key, { name: 'Groceries' });
			await TransactionEngine.recordTransaction(
				key,
				{ accountId: bank.id, date: '2026-03-05', amount: -2_000, type: 'expense' },
				[{ categoryId: groceries.id, amount: -2_000 }]
			);
			await TransactionEngine.recordTransfer(key, {
				fromAccountId: bank.id,
				toAccountId: card.id,
				amount: 15_000,
				date: '2026-03-10'
			});

			const breakdown = await categoryBreakdown(key, '2026-03-01', '2026-03-31');
			expect(breakdown).toEqual([
				{ categoryId: groceries.id, categoryName: 'Groceries', total: 2_000 }
			]);
		});
	});

	describe('importing a bank statement that contains a card payment line', () => {
		const mapping = (accountId: string): ColumnMapping => ({
			dateColumn: 'Date',
			amountColumn: 'Amount',
			descriptionColumn: 'Description',
			accountId,
			dateFormat: 'YYYY-MM-DD',
			amountSignConvention: 'negative-is-expense'
		});

		it('keeps the payment on the bank account instead of charging it to the card', async () => {
			const result = await importRows(
				key,
				[
					{ Date: '2026-03-10', Amount: '-150.00', Description: 'CREDIT CARD PAYMENT XX1234' },
					{ Date: '2026-03-11', Amount: '-20.00', Description: 'Card ending 1234 at Amazon' }
				],
				mapping(bank.id),
				[bank, card]
			);
			expect(result.createdCount).toBe(2);

			const onBank = await TransactionRepository.search(key, { accountId: bank.id });
			const onCard = await TransactionRepository.search(key, { accountId: card.id });
			// The payment stays with the account that paid it...
			expect(onBank.map((t) => t.amount)).toEqual([-15_000]);
			// ...while a real purchase on the card is still routed to the card.
			expect(onCard.map((t) => t.amount)).toEqual([-2_000]);
		});
	});
});
