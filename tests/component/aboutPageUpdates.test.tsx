import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ available: false }));

vi.mock('../../src/hooks/useQuickTour', () => ({ useQuickTour: () => ({ startTour: vi.fn() }) }));
vi.mock('../../src/lib/native/nativeAppUpdate', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/lib/native/nativeAppUpdate')>()),
	isNativeAppUpdateAvailable: () => mocks.available
}));

import { AboutPage } from '../../src/pages/AboutPage';

describe('About page: app updates', () => {
	beforeEach(() => {
		mocks.available = false;
	});

	it('shows the version but no update card in a browser or installed PWA', () => {
		render(<AboutPage />);
		expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument();
		expect(screen.getByText(__APP_VERSION__)).toBeInTheDocument();
		expect(screen.queryByText('App updates')).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Check for updates' })).not.toBeInTheDocument();
	});

	it('shows the update card inside the Android app', () => {
		mocks.available = true;
		render(<AboutPage />);
		expect(screen.getByText('App updates')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
	});
});
