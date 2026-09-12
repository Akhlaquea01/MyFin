import { describe, it, expect } from 'vitest';
import { buildReportPdfBlob, reportPdfFilename } from '../../src/data/io/reportPdfExport';
import type { ReportSummary } from '../../src/domain/reports/reportEngine';

function populatedSummary(): ReportSummary {
	return {
		period: { type: 'monthly', year: 2026, month: 3 },
		periodStart: '2026-03-01',
		periodEnd: '2026-03-31',
		periodLabel: 'March 2026',
		isInProgress: false,
		income: 50000,
		expense: 20000,
		netIncome: 30000,
		topCategories: [
			{ categoryId: 'groceries', categoryName: 'Groceries', total: 12000 },
			{ categoryId: 'dining', categoryName: 'Dining', total: 8000 }
		],
		netWorthStart: 100000,
		netWorthEnd: 130000,
		netWorthDelta: 30000
	};
}

function emptySummary(): ReportSummary {
	return {
		period: { type: 'yearly', year: 2020 },
		periodStart: '2020-01-01',
		periodEnd: '2020-12-31',
		periodLabel: '2020',
		isInProgress: false,
		income: 0,
		expense: 0,
		netIncome: 0,
		topCategories: [],
		netWorthStart: null,
		netWorthEnd: null,
		netWorthDelta: null
	};
}

describe('buildReportPdfBlob', () => {
	it('produces a non-empty PDF blob for a populated summary', () => {
		const blob = buildReportPdfBlob(populatedSummary());
		expect(blob.type).toBe('application/pdf');
		expect(blob.size).toBeGreaterThan(0);
	});

	it('produces a non-empty PDF blob for an all-zero/all-null summary without throwing', () => {
		const blob = buildReportPdfBlob(emptySummary());
		expect(blob.type).toBe('application/pdf');
		expect(blob.size).toBeGreaterThan(0);
	});
});

describe('reportPdfFilename', () => {
	it('produces a distinct, filesystem-safe filename for a monthly summary', () => {
		expect(reportPdfFilename(populatedSummary())).toBe('myfin-report-march-2026.pdf');
	});

	it('produces a distinct, filesystem-safe filename for a yearly summary', () => {
		expect(reportPdfFilename(emptySummary())).toBe('myfin-report-2020.pdf');
	});

	it('produces different filenames for different periods', () => {
		const a = reportPdfFilename(populatedSummary());
		const b = reportPdfFilename(emptySummary());
		expect(a).not.toBe(b);
	});
});
