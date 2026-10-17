import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppUpdateCard } from '../../src/components/AppUpdateCard';
import { createAppUpdateStore, type AppUpdateApi } from '../../src/lib/appUpdateStore';
import { describeUpdateError } from '../../src/lib/native/nativeAppUpdate';

const NEWER = {
	installedVersion: '0.1.92',
	latestVersion: '0.1.93',
	updateAvailable: true,
	size: 8 * 1024 * 1024,
	notes: '- Fix calendar dates\n- Add in-app updates',
	publishedAt: '2026-10-17T10:00:00Z'
};

function renderCard(overrides: Partial<AppUpdateApi> = {}) {
	const api = {
		check: vi.fn(async () => NEWER),
		download: vi.fn<AppUpdateApi['download']>(async () => {}),
		install: vi.fn(async () => 'started' as const),
		describeError: describeUpdateError,
		...overrides
	} satisfies AppUpdateApi;
	const store = createAppUpdateStore(api);
	render(<AppUpdateCard store={store} />);
	return { api, user: userEvent.setup() };
}

describe('AppUpdateCard', () => {
	it('starts with a check button and nothing else to do', () => {
		renderCard();
		expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
		expect(screen.queryByRole('button', { name: /Download and install/ })).not.toBeInTheDocument();
	});

	it('says so when the installed version is the latest', async () => {
		const { user } = renderCard({
			check: vi.fn(async () => ({
				...NEWER,
				installedVersion: '0.1.93',
				updateAvailable: false,
				size: 0
			}))
		});
		await user.click(screen.getByRole('button', { name: 'Check for updates' }));
		expect(await screen.findByText(/You have the latest version \(0\.1\.93\)/)).toBeInTheDocument();
	});

	it('shows the new version with its size and notes, then downloads and opens the installer', async () => {
		const { api, user } = renderCard();
		await user.click(screen.getByRole('button', { name: 'Check for updates' }));

		expect(await screen.findByText(/Version 0\.1\.93 is available/)).toBeInTheDocument();
		expect(screen.getByText(/8\.0 MB/)).toBeInTheDocument();
		expect(screen.getByText(/Add in-app updates/)).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: /Download and install/ }));
		expect(api.download).toHaveBeenCalledTimes(1);
		expect(api.install).toHaveBeenCalledTimes(1);
		expect(await screen.findByText(/Confirm the update in Android/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Install/ })).toBeEnabled();
	});

	it('guides the user through allowing installs, then installs on the next tap', async () => {
		const install = vi
			.fn<() => Promise<'started' | 'permission-needed'>>()
			.mockResolvedValueOnce('permission-needed')
			.mockResolvedValueOnce('started');
		const { user } = renderCard({ install });
		await user.click(screen.getByRole('button', { name: 'Check for updates' }));
		await user.click(await screen.findByRole('button', { name: /Download and install/ }));

		expect(await screen.findByText(/Allow from this source/)).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: /^Install$/ }));
		expect(await screen.findByText(/Confirm the update in Android/)).toBeInTheDocument();
		expect(install).toHaveBeenCalledTimes(2);
	});

	it('shows a failed check as an alert and lets the user check again', async () => {
		const check = vi
			.fn<AppUpdateApi['check']>()
			.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'offline' }))
			.mockResolvedValueOnce(NEWER);
		const { user } = renderCard({ check });
		await user.click(screen.getByRole('button', { name: 'Check for updates' }));

		expect(await screen.findByRole('alert')).toHaveTextContent(/Could not reach GitHub/);
		expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Check for updates' }));
		expect(await screen.findByText(/Version 0\.1\.93 is available/)).toBeInTheDocument();
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	it('keeps the release details visible when the download fails, and offers Try again', async () => {
		const download = vi
			.fn<AppUpdateApi['download']>()
			.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'download-failed' }))
			.mockResolvedValueOnce(undefined);
		const { user } = renderCard({ download });
		await user.click(screen.getByRole('button', { name: 'Check for updates' }));
		await user.click(await screen.findByRole('button', { name: /Download and install/ }));

		expect(await screen.findByRole('alert')).toHaveTextContent(/The download failed/);
		expect(screen.getByText(/Version 0\.1\.93 is available/)).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Try again' }));
		expect(await screen.findByText(/Confirm the update in Android/)).toBeInTheDocument();
	});

	it('shows download progress and disables checking meanwhile', async () => {
		let report: (received: number, total: number) => void = () => {};
		let finish: () => void = () => {};
		const download = vi.fn(
			(onProgress: (received: number, total: number) => void) =>
				new Promise<void>((resolve) => {
					report = onProgress;
					finish = resolve;
				})
		);
		const { user } = renderCard({ download });
		await user.click(screen.getByRole('button', { name: 'Check for updates' }));
		await user.click(await screen.findByRole('button', { name: /Download and install/ }));

		report(4 * 1024 * 1024, 8 * 1024 * 1024);
		expect(await screen.findByText(/Downloading… 4\.0 MB of 8\.0 MB/)).toBeInTheDocument();
		expect(screen.getByRole('progressbar', { name: 'Download progress' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Check for updates' })).not.toBeInTheDocument();

		finish();
		expect(await screen.findByText(/Confirm the update in Android/)).toBeInTheDocument();
	});
});
