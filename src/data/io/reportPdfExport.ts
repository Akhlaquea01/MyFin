import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReportSummary } from '../../domain/reports/reportEngine';

// jspdf-autotable sets `doc.lastAutoTable` as a side effect of autoTable() but does not
// augment jsPDF's own type declarations for it.
type DocWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

function formatNetWorth(value: number | null): string {
	return value === null ? 'Not available' : formatMoney(value);
}

/**
 * Renders a single-page PDF summary from an already-generated ReportSummary — no repository
 * access, no CryptoKey; every figure is exactly what's already on screen (FR-005).
 */
export function buildReportPdfBlob(summary: ReportSummary): Blob {
	const doc = new jsPDF();
	const marginX = 14;
	let y = 20;

	doc.setFontSize(18);
	doc.text('MyFin Report', marginX, y);
	y += 8;

	doc.setFontSize(13);
	doc.text(summary.periodLabel, marginX, y);
	y += 8;

	if (summary.isInProgress) {
		doc.setFontSize(10);
		doc.setTextColor(120);
		doc.text('Reflects data recorded up to the time this report was generated.', marginX, y);
		doc.setTextColor(0);
		y += 8;
	}

	doc.setFontSize(11);
	doc.text(`Income: ${formatMoney(summary.income)}`, marginX, y);
	y += 6;
	doc.text(`Expense: ${formatMoney(summary.expense)}`, marginX, y);
	y += 6;
	doc.text(`Net income: ${formatMoney(summary.netIncome)}`, marginX, y);
	y += 10;

	doc.setFontSize(12);
	doc.text('Top spending categories', marginX, y);
	y += 4;

	if (summary.topCategories.length === 0) {
		doc.setFontSize(10);
		doc.text('No spending recorded for this period.', marginX, y + 6);
		y += 14;
	} else {
		autoTable(doc, {
			startY: y + 2,
			head: [['Category', 'Amount']],
			body: summary.topCategories.map((c) => [c.categoryName, formatMoney(c.total)]),
			margin: { left: marginX, right: marginX }
		});
		y = ((doc as DocWithAutoTable).lastAutoTable?.finalY ?? y) + 10;
	}

	doc.setFontSize(12);
	doc.text('Net worth', marginX, y);
	y += 6;
	doc.setFontSize(11);
	doc.text(`Start of period: ${formatNetWorth(summary.netWorthStart)}`, marginX, y);
	y += 6;
	doc.text(`End of period: ${formatNetWorth(summary.netWorthEnd)}`, marginX, y);
	y += 6;
	doc.text(`Change: ${formatNetWorth(summary.netWorthDelta)}`, marginX, y);

	return doc.output('blob');
}

/** e.g. "myfin-report-march-2026.pdf" / "myfin-report-2026.pdf" — distinct per period. */
export function reportPdfFilename(summary: ReportSummary): string {
	const slug = summary.periodLabel.toLowerCase().replace(/\s+/g, '-');
	return `myfin-report-${slug}.pdf`;
}
