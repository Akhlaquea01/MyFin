import { render, renderHook, screen, within, act } from '@testing-library/react';
import { Chart, type ChartConfiguration } from 'chart.js';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartDataTable } from '../../src/components/ChartCanvas';
import { useChartColors } from '../../src/hooks/useChartColors';
import { setThemePreference } from '../../src/lib/theme';

afterEach(() => {
	localStorage.clear();
	document.documentElement.classList.remove('dark');
});

describe('ChartCanvas', () => {
	it('registers the Filler plugin, without which `fill: true` draws nothing', () => {
		expect(Chart.registry.plugins.get('filler')).toBeDefined();
	});
});

const config: ChartConfiguration = {
	type: 'bar',
	data: {
		labels: ['2026-09', '2026-10'],
		datasets: [
			{ label: 'Income', data: [1000, 2500] },
			{ label: 'Expense', data: [400, null] }
		]
	}
};

describe('ChartDataTable', () => {
	it('lists every label against every series, as a named table', () => {
		render(
			<ChartDataTable config={config} label="Bar chart of income vs. expense: long summary" />
		);
		const table = screen.getByRole('table', {
			name: 'Bar chart of income vs. expense, data table'
		});

		expect(
			within(table)
				.getAllByRole('columnheader')
				.map((h) => h.textContent)
		).toEqual(['Label', 'Income', 'Expense']);
		const rows = within(table).getAllByRole('row').slice(1);
		expect(
			rows.map((r) =>
				within(r)
					.getAllByRole('cell')
					.map((c) => c.textContent)
			)
		).toEqual([
			['1000', '400'],
			['2500', 'No data']
		]);
		expect(within(rows[0]).getByRole('rowheader')).toHaveTextContent('2026-09');
	});

	it('formats values with the caller’s formatter', () => {
		render(
			<ChartDataTable config={config} label="Chart" formatValue={(v) => `₹${v.toFixed(2)}`} />
		);
		expect(screen.getByRole('cell', { name: '₹1000.00' })).toBeInTheDocument();
	});

	it('names an unlabelled series rather than leaving an empty header', () => {
		render(
			<ChartDataTable
				config={{ type: 'line', data: { labels: ['a'], datasets: [{ data: [1] }] } }}
				label="Chart"
			/>
		);
		expect(screen.getByRole('columnheader', { name: 'Series 1' })).toBeInTheDocument();
	});
});

describe('useChartColors', () => {
	it('returns the same object between renders, so memoized chart configs are not rebuilt', () => {
		const { result, rerender } = renderHook(() => useChartColors());
		const first = result.current;
		rerender();
		expect(result.current).toBe(first);
	});

	it('returns a new object when the theme changes, which is what redraws the chart', () => {
		setThemePreference('light');
		const { result } = renderHook(() => useChartColors());
		const light = result.current;
		expect(light.theme).toBe('light');

		act(() => setThemePreference('dark'));
		expect(result.current).not.toBe(light);
		expect(result.current.theme).toBe('dark');
	});
});
