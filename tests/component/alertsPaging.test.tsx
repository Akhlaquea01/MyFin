import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configure, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ key: null as CryptoKey | null }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/context/SessionContext', () => ({
	useSession: () => ({ getEncryptionKey: () => mocks.key })
}));

import { AlertsPage } from '../../src/pages/AlertsPage';
import { db } from '../../src/data/dexie/db';
import { NotificationInboxRepository } from '../../src/data/dexie/notificationInboxRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

async function seedAlerts(count: number) {
	for (let i = 0; i < count; i++) {
		await NotificationInboxRepository.addIfMissing(mocks.key!, {
			dedupeKey: `alert-${i}`,
			kind: 'recurring',
			title: `Bill ${i}`,
			body: 'Due soon',
			route: '/recurring'
		});
	}
}

// Findable UI is waited for up to 5 s, not Testing Library's 1 s: with the rest of the suite running
// beside this file, decrypting the seeded list can take longer than that.
configure({ asyncUtilTimeout: 5_000 });

describe('AlertsPage with many alerts', () => {
	// Seeding 45 alerts is 45 encrypted writes: about a second alone, 3-6 s while the full suite runs in
	// parallel, which is past Vitest's 5 s default. 45 is needed to show both "Show 20 more" and
	// "Show 5 more", so the test gets room instead of being shrunk.
	vi.setConfig({ testTimeout: 30_000 });

	beforeEach(async () => {
		await db.delete();
		await db.open();
		mocks.key = await deriveEncryptionKey('4242', randomSaltBase64());
	});

	it('shows one page of alerts, then a page more each time it is asked for', async () => {
		await seedAlerts(45);
		const user = userEvent.setup();
		render(
			<MemoryRouter>
				<AlertsPage />
			</MemoryRouter>
		);

		expect(await screen.findAllByRole('listitem')).toHaveLength(20);
		await user.click(screen.getByRole('button', { name: 'Show 20 more (25 not shown)' }));
		expect(screen.getAllByRole('listitem')).toHaveLength(40);
		await user.click(screen.getByRole('button', { name: 'Show 5 more (5 not shown)' }));
		expect(screen.getAllByRole('listitem')).toHaveLength(45);
		expect(screen.queryByRole('button', { name: /Show \d+ more/ })).not.toBeInTheDocument();
	});

	it('offers no Show more when everything fits on one page', async () => {
		await seedAlerts(3);
		render(
			<MemoryRouter>
				<AlertsPage />
			</MemoryRouter>
		);

		expect(await screen.findAllByRole('listitem')).toHaveLength(3);
		expect(screen.queryByRole('button', { name: /Show \d+ more/ })).not.toBeInTheDocument();
	});
});
