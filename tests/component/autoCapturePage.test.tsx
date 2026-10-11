import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';

const mocks = vi.hoisted(() => ({
	available: true,
	status: {
		sdkInt: 34,
		sms: 'prompt',
		postNotifications: 'prompt',
		notificationListenerEnabled: false,
		alertsEnabled: true,
		sealingKeyPresent: false,
		smsEnabled: false,
		notificationsEnabled: false,
		pending: 0,
		dropped: 0
	} as Record<string, unknown>,
	requestPermissions: vi.fn(),
	openNotificationAccessSettings: vi.fn(),
	openAppSettings: vi.fn(),
	enableCapture: vi.fn(),
	disableCapture: vi.fn(),
	drain: vi.fn()
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/lib/native/transactionCapture', () => ({
	isTransactionCaptureAvailable: () => mocks.available,
	SELF_TEST_TEXT: 'myfin-capture-self-test',
	TransactionCapture: {
		getStatus: vi.fn(async () => ({ ...mocks.status })),
		requestPermissions: (...args: unknown[]) => mocks.requestPermissions(...args),
		openNotificationAccessSettings: () => mocks.openNotificationAccessSettings(),
		openAppSettings: () => mocks.openAppSettings()
	}
}));
vi.mock('../../src/data/io/captureSetup', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/data/io/captureSetup')>()),
	enableCapture: (...args: unknown[]) => mocks.enableCapture(...args),
	disableCapture: () => mocks.disableCapture()
}));
vi.mock('../../src/data/io/captureDrain', () => ({
	drainCapturedTransactions: (...args: unknown[]) => mocks.drain(...args),
	REVIEW_CHANGED_EVENT: 'myfin:review-changed'
}));

import { toast } from 'sonner';
import { AutoCapturePage } from '../../src/pages/AutoCapturePage';
import { SessionProvider, useSession } from '../../src/context/SessionContext';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { db } from '../../src/data/dexie/db';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';

function Unlocked({ keyToUse }: { keyToUse: CryptoKey }) {
	const session = useSession();
	const { unlock, isLocked } = session;
	useEffect(() => {
		unlock(keyToUse, 300_000);
	}, [unlock, keyToUse]);
	return isLocked ? null : <AutoCapturePage />;
}

describe('AutoCapturePage', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		vi.clearAllMocks();
		mocks.available = true;
		mocks.status = {
			sdkInt: 34,
			sms: 'prompt',
			postNotifications: 'prompt',
			notificationListenerEnabled: false,
			alertsEnabled: true,
			sealingKeyPresent: false,
			smsEnabled: false,
			notificationsEnabled: false,
			pending: 0,
			dropped: 0
		};
		mocks.enableCapture.mockResolvedValue({});
		mocks.drain.mockResolvedValue(null);
		await db.delete();
		await db.open();
		const pinSalt = randomSaltBase64();
		const encryptionSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin('8383', pinSalt),
			pinSalt,
			encryptionSalt,
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: true
		});
		key = await deriveEncryptionKey('8383', encryptionSalt);
	});

	const renderPage = () =>
		render(<Unlocked keyToUse={key} />, {
			wrapper: ({ children }) => <SessionProvider>{children}</SessionProvider>
		});
	const addAccount = (name: string) =>
		AccountRepository.create(key, {
			name,
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});

	it('says it is Android-only on the web instead of showing controls that cannot work', async () => {
		mocks.available = false;
		renderPage();
		expect(await screen.findByText(/only available in the MyFin Android app/)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Turn on auto-capture/ })).toBeNull();
	});

	it('lists what still needs doing and keeps the switch off until it is done', async () => {
		await addAccount('HDFC');
		renderPage();

		const turnOn = await screen.findByRole('button', { name: 'Turn on auto-capture' });
		expect(turnOn).toBeDisabled();
		// One account, so it is already the default; SMS and notification access are what is missing.
		expect(
			await screen.findByText(/allow reading SMS, turn on notification access/)
		).toBeInTheDocument();
		expect(mocks.enableCapture).not.toHaveBeenCalled();
	});

	it('asks Android for SMS permission and says how to get past a block when it is refused', async () => {
		await addAccount('HDFC');
		mocks.requestPermissions.mockResolvedValue({ sms: 'denied', postNotifications: 'prompt' });
		renderPage();

		await userEvent.click((await screen.findAllByRole('button', { name: 'Allow' }))[0]);

		expect(mocks.requestPermissions).toHaveBeenCalledWith(['sms']);
		expect(await screen.findByText(/If Android blocks this/)).toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'Open App info' }));
		expect(mocks.openAppSettings).toHaveBeenCalled();
	});

	it("opens Android's notification access screen", async () => {
		await addAccount('HDFC');
		renderPage();
		await userEvent.click((await screen.findAllByRole('button', { name: 'Open settings' }))[0]);
		expect(mocks.openNotificationAccessSettings).toHaveBeenCalled();
	});

	it('turns capture on with the chosen sources and default account once everything is allowed', async () => {
		const account = await addAccount('HDFC');
		mocks.status = {
			...mocks.status,
			sms: 'granted',
			notificationListenerEnabled: true,
			postNotifications: 'granted'
		};
		renderPage();

		const turnOn = await screen.findByRole('button', { name: 'Turn on auto-capture' });
		await waitFor(() => expect(turnOn).toBeEnabled());
		await userEvent.click(turnOn);

		await waitFor(() =>
			expect(mocks.enableCapture).toHaveBeenCalledWith(key, {
				sms: true,
				notifications: true,
				defaultAccountId: account.id
			})
		);
		// Picks up anything that arrived while it was being set up.
		await waitFor(() => expect(mocks.drain).toHaveBeenCalled());
	});

	it('shows the specific reason when the secure-storage check fails', async () => {
		const { CaptureSetupError } = await import('../../src/data/io/captureSetup');
		await addAccount('HDFC');
		mocks.status = { ...mocks.status, sms: 'granted', notificationListenerEnabled: true };
		mocks.enableCapture.mockRejectedValue(
			new CaptureSetupError('The secure storage check failed.')
		);
		renderPage();

		const turnOn = await screen.findByRole('button', { name: 'Turn on auto-capture' });
		await waitFor(() => expect(turnOn).toBeEnabled());
		await act(async () => {
			await userEvent.click(turnOn);
		});

		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith('The secure storage check failed.')
		);
	});
});
