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
import { UserProfileRepository } from '../../data/dexie/userProfileRepository';
import { LiabilityRepository } from '../../data/dexie/wealthRepository';

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
