import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

	it('draws nothing from md up, where the sidebar already shows every screen', () => {
		setMobile(false);
		const { container } = at('/budgets');
		expect(container).toBeEmptyDOMElement();
	});

	it('draws nothing on a page outside every hub', () => {
		setMobile(true);
		const { container } = at('/');
		expect(container).toBeEmptyDOMElement();
	});
});
