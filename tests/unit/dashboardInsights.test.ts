import { describe, it, expect } from 'vitest';
import {
	fillMonths,
	foldTail,
	lastMonths,
	monthEnd
} from '../../src/domain/analytics/dashboardInsights';
import { meterTone } from '../../src/components/charts/meterTone';

describe('lastMonths', () => {
	it('lists the months ending at the current one, oldest first', () => {
		expect(lastMonths('2026-10-15', 6)).toEqual([
			'2026-05',
			'2026-06',
			'2026-07',
			'2026-08',
			'2026-09',
			'2026-10'
		]);
	});

	it('crosses a year boundary', () => {
		expect(lastMonths('2026-02-03', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
	});

	it('is just the current month for a count of one', () => {
		expect(lastMonths('2026-10-31', 1)).toEqual(['2026-10']);
	});
});

describe('monthEnd', () => {
	it.each([
		['2026-10', '2026-10-31'],
		['2026-02', '2026-02-28'],
		['2028-02', '2028-02-29'],
		['2026-12', '2026-12-31']
	])('ends %s on %s', (month, last) => {
		expect(monthEnd(month)).toBe(last);
	});
});

describe('fillMonths', () => {
	it('keeps the months that have figures and zero-fills the rest, in the order asked for', () => {
		const filled = fillMonths(
			['2026-08', '2026-09', '2026-10'],
			[{ month: '2026-09', income: 500, expense: 200, netFlow: 300 }]
		);
		expect(filled).toEqual([
			{ month: '2026-08', income: 0, expense: 0, netFlow: 0 },
			{ month: '2026-09', income: 500, expense: 200, netFlow: 300 },
			{ month: '2026-10', income: 0, expense: 0, netFlow: 0 }
		]);
	});

	it('ignores a month outside the window', () => {
		expect(
			fillMonths(['2026-10'], [{ month: '2020-01', income: 1, expense: 1, netFlow: 0 }])
		).toEqual([{ month: '2026-10', income: 0, expense: 0, netFlow: 0 }]);
	});
});

describe('foldTail', () => {
	const slice = (id: string, total: number) => ({ id, label: id, total, color: `var(--${id})` });

	it('leaves a short list alone', () => {
		const slices = [slice('a', 30), slice('b', 20)];
		expect(foldTail(slices, 5)).toEqual(slices);
	});

	it('adds everything past the limit into one neutral "Other" at the end', () => {
		const folded = foldTail([slice('a', 50), slice('b', 30), slice('c', 15), slice('d', 5)], 2);
		expect(folded.map((s) => [s.id, s.total])).toEqual([
			['a', 50],
			['b', 30],
			['__other__', 20]
		]);
		expect(folded[2]).toMatchObject({ label: 'Other', color: 'var(--muted-foreground)' });
	});

	it('keeps the total the same', () => {
		const slices = [slice('a', 7), slice('b', 6), slice('c', 5), slice('d', 4), slice('e', 3)];
		const sum = (list: { total: number }[]) => list.reduce((n, s) => n + s.total, 0);
		expect(sum(foldTail(slices, 3))).toBe(sum(slices));
	});
});

describe('meterTone', () => {
	it('is fine below three quarters, close from there to the limit, over past it', () => {
		expect(meterTone(0, 100)).toBe('good');
		expect(meterTone(74, 100)).toBe('good');
		expect(meterTone(75, 100)).toBe('warning');
		expect(meterTone(100, 100)).toBe('warning');
		expect(meterTone(101, 100)).toBe('danger');
	});

	it('treats any spend against a zero limit as over, and nothing as fine', () => {
		expect(meterTone(5, 0)).toBe('danger');
		expect(meterTone(0, 0)).toBe('good');
	});
});
