import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigationType } from 'react-router-dom';
import { HubTabs } from '../../src/components/HubTabs';

function setMobile(isMobile: boolean) {
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: isMobile,
		media: query,
		onchange: null,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false
	}));
}

const at = (path: string) =>
	render(
		<MemoryRouter initialEntries={[path]}>
			<HubTabs />
		</MemoryRouter>
	);

afterEach(() => vi.unstubAllGlobals());

describe('HubTabs', () => {
	it('lists the sibling screens on a phone and marks the open one', () => {
		setMobile(true);
		at('/budgets/variance');
		const nav = screen.getByRole('navigation', { name: 'Plan screens' });
		expect(nav).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Budgets' })).toHaveAttribute('href', '/budgets');
		expect(screen.getByRole('link', { name: 'Budget vs. Actual' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		expect(screen.getByRole('link', { name: 'Budgets' })).not.toHaveAttribute('aria-current');
	});

	it('draws the screens of a folded hub from md up too, since the sidebar lists it once', () => {
		setMobile(false);
		at('/export');
		const nav = screen.getByRole('navigation', { name: 'Data screens' });
		expect(nav).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Import' })).toHaveAttribute('href', '/import');
		expect(screen.getByRole('link', { name: 'Backup' })).toHaveAttribute('href', '/backup');
		expect(screen.getByRole('link', { name: 'Export' })).toHaveAttribute('aria-current', 'page');
	});

	it('draws nothing from md up on a hub the sidebar already lists screen by screen', () => {
		setMobile(false);
		const { container } = at('/budgets');
		expect(container).toBeEmptyDOMElement();
	});

	it('draws nothing on a page outside every hub', () => {
		setMobile(true);
		const { container } = at('/');
		expect(container).toBeEmptyDOMElement();
	});
	it('swaps the open screen for the one tapped instead of stacking another history entry', async () => {
		setMobile(true);
		function HowWeArrived() {
			return <output data-testid="navigation-type">{useNavigationType()}</output>;
		}
		render(
			<MemoryRouter initialEntries={['/budgets']}>
				<HubTabs />
				<HowWeArrived />
			</MemoryRouter>
		);
		expect(screen.getByTestId('navigation-type')).toHaveTextContent('POP');
		await userEvent.click(screen.getByRole('link', { name: 'Forecast' }));
		expect(screen.getByTestId('navigation-type')).toHaveTextContent('REPLACE');
		expect(screen.getByRole('link', { name: 'Forecast' })).toHaveAttribute('aria-current', 'page');
	});
});
