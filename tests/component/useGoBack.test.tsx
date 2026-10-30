import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useGoBack } from '../../src/hooks/useGoBack';

function Probe() {
	const goBack = useGoBack('/transactions');
	return (
		<>
			<output data-testid="path">{useLocation().pathname}</output>
			<button onClick={goBack}>Cancel</button>
		</>
	);
}

const open = (entries: string[]) =>
	render(
		<MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
			<Probe />
		</MemoryRouter>
	);

afterEach(() => window.history.replaceState(null, ''));

describe('useGoBack', () => {
	it('returns to the screen the user came from', async () => {
		// React Router keeps the entry's position in history.state; above 0 there is an earlier screen.
		window.history.replaceState({ idx: 1 }, '');
		open(['/', '/transactions/new']);
		await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/);
	});

	it('falls back to the given screen when this one was opened directly', async () => {
		window.history.replaceState({ idx: 0 }, '');
		open(['/transactions/new']);
		await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.getByTestId('path')).toHaveTextContent('/transactions');
		expect(screen.getByTestId('path')).not.toHaveTextContent('/transactions/new');
	});

	it('falls back when the browser reports no position at all', async () => {
		open(['/', '/transactions/new']);
		await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.getByTestId('path')).toHaveTextContent(/^\/transactions$/);
	});
});
