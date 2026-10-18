import { describe, it, expect } from 'vitest';
import { describeNetWorthSeries } from '../../src/lib/netWorthSeriesLabel';

const day = (n: number) => `2026-01-${String(n).padStart(2, '0')}`;

describe('describeNetWorthSeries', () => {
	it('reads out every point of a short series', () => {
		const label = describeNetWorthSeries([
			{ date: day(1), netWorth: 100_000 },
			{ date: day(2), netWorth: 150_000 }
		]);
		expect(label).toContain(day(1));
		expect(label).toContain(day(2));
		expect(label).toContain('1,000.00');
		expect(label).toContain('1,500.00');
	});

	it('names only the two ends of a long daily series', () => {
		const points = Array.from({ length: 365 }, (_, i) => ({
			date: `2025-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
			netWorth: 100_000 + i * 100
		}));
		const label = describeNetWorthSeries(points);
		expect(label).toContain('365 days');
		expect(label).toContain(points[0].date);
		expect(label).toContain(points[364].date);
		expect(label.length).toBeLessThan(200);
	});
});
