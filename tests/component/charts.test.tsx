import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarList } from '../../src/components/charts/BarList';
import { ProgressBar } from '../../src/components/charts/ProgressBar';
import { TrendBars } from '../../src/components/charts/TrendBars';

const money = (n: number) => `₹${n / 100}`;

describe('BarList', () => {
	const items = [
		{ id: 'a', label: 'Food', value: 20_000, color: 'red', note: '67%' },
		{ id: 'b', label: 'Travel', value: 10_000, color: 'blue' }
	];

	it('writes every label and figure out, so the bars are never the only way to read one', () => {
		render(<BarList items={items} format={money} />);
		expect(screen.getByText('Food')).toBeInTheDocument();
		expect(screen.getByText('₹200')).toBeInTheDocument();
		expect(screen.getByText('67%')).toBeInTheDocument();
		expect(screen.getByText('Travel')).toBeInTheDocument();
		expect(screen.getByText('₹100')).toBeInTheDocument();
	});

	it('scales every bar against the biggest on one shared scale', () => {
		const { container } = render(<BarList items={items} format={money} />);
		const fills = [...container.querySelectorAll<HTMLElement>('[aria-hidden] > div')];
		expect(fills.map((f) => f.style.width)).toEqual(['100%', '50%']);
	});

	it('does not divide by zero when every value is zero', () => {
		const { container } = render(
			<BarList items={[{ id: 'a', label: 'Nothing', value: 0, color: 'red' }]} format={money} />
		);
		expect(container.querySelector<HTMLElement>('[aria-hidden] > div')?.style.width).toBe('0%');
	});
});

describe('ProgressBar', () => {
	it('exposes how much of the limit is used', () => {
		render(<ProgressBar value={40} max={100} label="Food budget used" />);
		const bar = screen.getByRole('progressbar', { name: 'Food budget used' });
		expect(bar).toHaveAttribute('aria-valuenow', '40');
		expect(bar).toHaveAttribute('aria-valuemax', '100');
	});

	it('fills to the brim, never past it, when over the limit', () => {
		const { container } = render(<ProgressBar value={250} max={100} label="Over" />);
		expect(container.querySelector<HTMLElement>('[role="progressbar"] > div')?.style.width).toBe(
			'100%'
		);
	});

	it('shows an empty bar for a zero limit and no spend', () => {
		const { container } = render(<ProgressBar value={0} max={0} label="None" />);
		expect(container.querySelector<HTMLElement>('[role="progressbar"] > div')?.style.width).toBe(
			'0%'
		);
	});
});

describe('TrendBars', () => {
	const points = [
		{ label: 'Aug', title: 'August 2026', income: 500_00, expense: 200_00 },
		{ label: 'Sep', title: 'September 2026', income: 0, expense: 0 },
		{ label: 'Oct', title: 'October 2026', income: 800_00, expense: 650_00 }
	];
	const render_ = () =>
		render(<TrendBars points={points} format={money} formatCompact={(n) => `~${n / 100}`} />);

	it('starts on the newest month and reads its figures out', () => {
		render_();
		const readout = screen.getByText('October 2026', { selector: 'p span' }).closest('p')!;
		expect(within(readout).getByText('₹800')).toBeInTheDocument();
		expect(within(readout).getByText('₹650')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /October 2026/ })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	});

	it('shows another month when its columns are tapped', async () => {
		const user = userEvent.setup();
		render_();
		await user.click(screen.getByRole('button', { name: /August 2026/ }));
		const readout = screen.getByText('August 2026', { selector: 'p span' }).closest('p')!;
		expect(within(readout).getByText('₹500')).toBeInTheDocument();
		expect(within(readout).getByText('₹200')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /August 2026/ })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	});

	it('gives each month an accessible name carrying both figures', () => {
		render_();
		expect(
			screen.getByRole('button', { name: 'August 2026: in ₹500, out ₹200' })
		).toBeInTheDocument();
	});

	it('draws a taller column for the bigger amount and none for zero, on one scale', () => {
		const { container } = render_();
		const heights = [
			...container.querySelectorAll<HTMLElement>('button span[style*="height"] > span')
		].map((s) => parseInt(s.style.height, 10));
		// Aug in/out, Sep in/out, Oct in/out.
		expect(heights[4]).toBeGreaterThan(heights[0]); // Oct income beats Aug income
		expect(heights[0]).toBeGreaterThan(heights[1]); // Aug income beats Aug expense
		expect(heights[2]).toBe(0);
		expect(heights[3]).toBe(0);
	});

	it('carries the same figures in a table', () => {
		render_();
		const table = screen.getByRole('table', { hidden: true });
		expect(within(table).getByText('September 2026')).toBeInTheDocument();
		expect(within(table).getAllByText('₹800')).toHaveLength(1);
	});

	it('draws nothing for no months', () => {
		const { container } = render(<TrendBars points={[]} format={money} formatCompact={money} />);
		expect(container).toBeEmptyDOMElement();
	});
});
