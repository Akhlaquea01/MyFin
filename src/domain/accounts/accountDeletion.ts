// Deleting an account. The repository refuses while anything in the ledger or the recurring
// schedule still points at it; this adds what lives elsewhere and would otherwise be left pointing
// at an account that no longer exists:
//
//   - a liability linked to it (`linkedAccountId`): net worth skips a linked card because the
//     account "already counted it", so deleting the account made that debt vanish from net worth
//     altogether. It is unlinked, so it counts in its own right again.
//   - the account captured bank messages fall back to (`capture.defaultAccountId`): with none
//     left, every captured message waits in the queue unfiled.
import { AccountRepository } from '../../data/dexie/accountRepository';
import { RecurringRepository } from '../../data/dexie/recurringRepository';
import { UserProfileRepository } from '../../data/dexie/userProfileRepository';
import { LiabilityRepository } from '../../data/dexie/wealthRepository';
import { formatMoney } from '../shared/money';

/**
 * Archives or restores an account. An archived account drops out of the Dashboard and Net Worth
 * totals and out of every account picker, so archiving is only allowed once nothing is left that would
 * silently disappear with it or keep running for a closed account:
 *
 *   - a balance: it would vanish from every reported total with no reconciling entry;
 *   - an active recurring payment: it would keep raising "Upcoming" alerts for the account, and the
 *     Recurring page could no longer name the account it is paid from. Deleting is refused for the same
 *     reason (a paused payment expects nothing, so it does not stand in the way).
 */
export async function setAccountArchived(
	key: CryptoKey,
	id: string,
	archived: boolean
): Promise<void> {
	if (archived) {
		const account = await AccountRepository.getById(key, id);
		if (!account) throw new Error('That account no longer exists.');
		if (account.currentBalance !== 0) {
			throw new Error(
				`${account.name} still has a balance of ${formatMoney(account.currentBalance)}. ` +
					'Move the money out with a transfer, or use "Adjust balance" to bring it to zero, then archive it.'
			);
		}
		const active = (await RecurringRepository.listActive(key)).filter((r) => r.accountId === id);
		if (active.length > 0) {
			throw new Error(
				`${account.name} still has ${active.length} active recurring ${
					active.length === 1 ? 'payment' : 'payments'
				}, which would keep sending reminders for a closed account. Pause or delete ${
					active.length === 1 ? 'it' : 'them'
				}, or move ${active.length === 1 ? 'it' : 'them'} to another account, first.`
			);
		}
	}
	await AccountRepository.update(key, id, { isArchived: archived });
}

export async function deleteAccount(key: CryptoKey, id: string): Promise<void> {
	// Throws (and changes nothing) while the account still has transactions or recurring payments.
	await AccountRepository.remove(id);

	for (const liability of await LiabilityRepository.list(key)) {
		if (liability.linkedAccountId === id) {
			await LiabilityRepository.update(key, liability.id, { linkedAccountId: null });
		}
	}

	const capture = (await UserProfileRepository.get())?.capture;
	if (capture?.defaultAccountId === id) {
		await UserProfileRepository.update({ capture: { ...capture, defaultAccountId: null } });
	}
}
