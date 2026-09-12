import { useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import { Download, FileText, Upload, CheckCircle2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Separator } from '../components/ui/separator';
import { Badge } from '../components/ui/badge';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogFooter
} from '../components/ui/dialog';
import { useSession } from '../context/SessionContext';
import { buildExportRows, exportToCsvBlob, exportToXlsxBlob } from '../data/io/exportService';
import {
	buildDataTemplate,
	exportDataTemplateToJsonBlob,
	parseDataTemplate,
	importDataTemplate
} from '../data/io/templateService';
import { SAMPLE_DATA_TEMPLATE } from '../data/io/sampleTemplate';
import type { TemplateImportResult } from '../data/io/templateTypes';
import { generateReportSummary } from '../domain/reports/reportService';
import { MONTH_NAMES, type ReportPeriod, type ReportSummary } from '../domain/reports/reportEngine';

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

const CURRENT_YEAR = new Date().getFullYear();
const REPORT_YEARS = Array.from({ length: 16 }, (_, i) => CURRENT_YEAR - i);

// User Story 9 (P9): export transactions to common formats (FR-039).
// Spec 011: a generated period summary, downloadable as PDF, alongside the raw export (FR-007).
// Spec 015: Complete Data Template export and additive import with duplicate detection (FR-001 - FR-014).
export function ExportPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);

	const [periodType, setPeriodType] = useState<'monthly' | 'yearly'>('monthly');
	const [year, setYear] = useState(CURRENT_YEAR);
	const [month, setMonth] = useState(new Date().getMonth() + 1);
	const [generating, setGenerating] = useState(false);
	const [summary, setSummary] = useState<ReportSummary | null>(null);
	const [downloadingPdf, setDownloadingPdf] = useState(false);
	const [exportingTemplate, setExportingTemplate] = useState(false);
	const [importingTemplate, setImportingTemplate] = useState(false);
	const [importResult, setImportResult] = useState<TemplateImportResult | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	async function handleExportTemplate() {
		setExportingTemplate(true);
		try {
			const template = await buildDataTemplate(key);
			const blob = exportDataTemplateToJsonBlob(template);
			const date = new Date().toISOString().slice(0, 10);
			saveAs(blob, `myfin-template-${date}.json`);
			toast.success('Exported complete data template');
		} catch (err) {
			toast.error('Failed to export data template');
		} finally {
			setExportingTemplate(false);
		}
	}

	function handleDownloadSampleTemplate() {
		const blob = exportDataTemplateToJsonBlob(SAMPLE_DATA_TEMPLATE);
		saveAs(blob, 'myfin-sample-template.json');
		toast.success('Downloaded sample data template');
	}

	async function handleImportTemplateFile(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file) return;

		setImportingTemplate(true);
		try {
			const text = await file.text();
			const parsed = parseDataTemplate(text);
			if (!parsed.ok) {
				toast.error(parsed.message);
				return;
			}

			const result = await importDataTemplate(key, parsed.template);
			setImportResult(result);
			toast.success('Template imported successfully');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to import template');
		} finally {
			setImportingTemplate(false);
			if (fileInputRef.current) {
				fileInputRef.current.value = '';
			}
		}
	}

	async function handleExport(format: 'csv' | 'xlsx') {
		setExporting(format);
		try {
			const rows = await buildExportRows(key);
			if (rows.length === 0) {
				toast.error('No transactions to export yet.');
				return;
			}
			const blob = format === 'csv' ? exportToCsvBlob(rows) : await exportToXlsxBlob(rows);
			const date = new Date().toISOString().slice(0, 10);
			saveAs(blob, `myfin-transactions-${date}.${format}`);
			toast.success(`Exported ${rows.length} transaction(s)`);
		} finally {
			setExporting(null);
		}
	}

	async function handleGenerateReport() {
		setGenerating(true);
		try {
			const period: ReportPeriod =
				periodType === 'monthly' ? { type: 'monthly', year, month } : { type: 'yearly', year };
			const result = await generateReportSummary(key, period);
			setSummary(result);
		} finally {
			setGenerating(false);
		}
	}

	async function handleDownloadReportPdf() {
		if (!summary) return;
		setDownloadingPdf(true);
		try {
			// Loaded on demand: jsPDF/jspdf-autotable are only needed by this one action, so
			// keeping them out of the main bundle keeps the app's install/precache payload small
			// for every user who never generates a report.
			const { buildReportPdfBlob, reportPdfFilename } = await import('../data/io/reportPdfExport');
			const blob = buildReportPdfBlob(summary);
			saveAs(blob, reportPdfFilename(summary));
			toast.success(`Downloaded report for ${summary.periodLabel}`);
		} finally {
			setDownloadingPdf(false);
		}
	}

	return (
		<div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
			<h1 className="mb-2 text-2xl font-semibold tracking-tight">Export Transactions</h1>
			<p className="mb-6 text-sm text-muted-foreground">
				Export your raw transaction data, or generate a summarized report for a period.
			</p>

			<Card>
				<CardContent className="flex flex-col gap-4 pt-6">
					<p className="text-sm text-muted-foreground">
						Export every transaction — date, account, categories, amount, and notes — to a file
						you can open elsewhere.
					</p>
					<div className="flex gap-3">
						<Button
							type="button"
							disabled={exporting !== null}
							onClick={() => void handleExport('csv')}
						>
							<Download /> {exporting === 'csv' ? 'Exporting…' : 'Export as CSV'}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={exporting !== null}
							onClick={() => void handleExport('xlsx')}
						>
							<Download /> {exporting === 'xlsx' ? 'Exporting…' : 'Export as XLSX'}
						</Button>
					</div>
				</CardContent>
			</Card>

			<Separator className="my-8" />

			<Card>
				<CardHeader>
					<CardTitle>Complete Data Template</CardTitle>
					<CardDescription>
						Export all of your financial records — accounts, categories, budgets, transactions,
						investments, liabilities, and settings — into a single, portable, human-readable JSON
						file. Distinct from an encrypted backup, this file is inspectable and unencrypted, and
						never contains your PIN, salts, or security credentials.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<p className="text-sm text-muted-foreground">
						Unlike full encrypted backup restore, importing a template is additive and non-destructive:
						it adds what's missing, flags likely duplicate transactions for review, and never overwrites
						or deletes existing data.
					</p>
					<div className="flex flex-wrap items-center gap-3">
						<Button
							type="button"
							disabled={exportingTemplate || importingTemplate}
							onClick={() => void handleExportTemplate()}
						>
							<Download /> {exportingTemplate ? 'Exporting Template…' : 'Export Template (JSON)'}
						</Button>

						<Button
							type="button"
							variant="outline"
							disabled={exportingTemplate || importingTemplate}
							onClick={() => fileInputRef.current?.click()}
						>
							<Upload /> {importingTemplate ? 'Importing Template…' : 'Import Template'}
						</Button>

						<Button
							type="button"
							variant="secondary"
							disabled={exportingTemplate || importingTemplate}
							onClick={handleDownloadSampleTemplate}
						>
							<Sparkles /> Download Sample Template
						</Button>

						<input
							ref={fileInputRef}
							type="file"
							accept=".json,application/json"
							className="hidden"
							onChange={(e) => void handleImportTemplateFile(e)}
						/>
					</div>
				</CardContent>
			</Card>

			<Separator className="my-8" />

			<Card>
				<CardHeader>
					<CardTitle>Generate a Report</CardTitle>
					<CardDescription>
						A summary of income, expenses, top spending categories, and net worth change for a
						month or year you choose.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="flex flex-wrap gap-3">
						<Select
							value={periodType}
							onValueChange={(v) => setPeriodType(v as 'monthly' | 'yearly')}
						>
							<SelectTrigger className="w-28" aria-label="Period type">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="monthly">Month</SelectItem>
								<SelectItem value="yearly">Year</SelectItem>
							</SelectContent>
						</Select>

						{periodType === 'monthly' && (
							<Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
								<SelectTrigger className="w-36" aria-label="Month">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{MONTH_NAMES.map((name, i) => (
										<SelectItem key={name} value={String(i + 1)}>
											{name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}

						<Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
							<SelectTrigger className="w-24" aria-label="Year">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{REPORT_YEARS.map((y) => (
									<SelectItem key={y} value={String(y)}>
										{y}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<Button
						type="button"
						disabled={generating}
						onClick={() => void handleGenerateReport()}
					>
						<FileText /> {generating ? 'Generating…' : 'Generate Report'}
					</Button>

					{summary && (
						<div className="flex flex-col gap-4 rounded-md border p-4 text-sm">
							<div className="flex items-center justify-between gap-2">
								<span className="font-medium">{summary.periodLabel}</span>
								{summary.isInProgress && (
									<span className="text-xs text-muted-foreground">
										Reflects data recorded up to today only
									</span>
								)}
							</div>

							<div className="grid grid-cols-3 gap-2 text-center">
								<div>
									<div className="text-xs text-muted-foreground">Income</div>
									<div>{formatMoney(summary.income)}</div>
								</div>
								<div>
									<div className="text-xs text-muted-foreground">Expense</div>
									<div>{formatMoney(summary.expense)}</div>
								</div>
								<div>
									<div className="text-xs text-muted-foreground">Net</div>
									<div>{formatMoney(summary.netIncome)}</div>
								</div>
							</div>

							<div>
								<div className="mb-1 text-xs text-muted-foreground">Top spending categories</div>
								{summary.topCategories.length === 0 ? (
									<p className="text-muted-foreground">No spending recorded for this period.</p>
								) : (
									<ul className="flex flex-col gap-1">
										{summary.topCategories.map((c) => (
											<li key={c.categoryId} className="flex justify-between">
												<span>{c.categoryName}</span>
												<span>{formatMoney(c.total)}</span>
											</li>
										))}
									</ul>
								)}
							</div>

							<div className="grid grid-cols-3 gap-2 text-center">
								<div>
									<div className="text-xs text-muted-foreground">Net worth (start)</div>
									<div>
										{summary.netWorthStart === null ? 'Not available' : formatMoney(summary.netWorthStart)}
									</div>
								</div>
								<div>
									<div className="text-xs text-muted-foreground">Net worth (end)</div>
									<div>
										{summary.netWorthEnd === null ? 'Not available' : formatMoney(summary.netWorthEnd)}
									</div>
								</div>
								<div>
									<div className="text-xs text-muted-foreground">Change</div>
									<div>
										{summary.netWorthDelta === null ? 'Not available' : formatMoney(summary.netWorthDelta)}
									</div>
								</div>
							</div>

							<Button
								type="button"
								variant="outline"
								disabled={downloadingPdf}
								onClick={() => void handleDownloadReportPdf()}
							>
								<Download /> {downloadingPdf ? 'Preparing PDF…' : 'Download PDF'}
							</Button>
						</div>
					)}
				</CardContent>
			</Card>

			<Dialog open={importResult !== null} onOpenChange={(open) => !open && setImportResult(null)}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<CheckCircle2 className="text-emerald-500 size-5" />
							Template Import Summary
						</DialogTitle>
						<DialogDescription>
							Import completed additively. Review the records that were created, skipped, or flagged below.
						</DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-3 py-2 max-h-80 overflow-y-auto pr-1">
						{importResult &&
							Object.entries(importResult.perEntity).map(([entity, stats]) => (
								<div
									key={entity}
									className="flex items-center justify-between border-b pb-2 text-sm last:border-0"
								>
									<span className="font-medium capitalize">
										{entity.replace(/([A-Z])/g, ' $1')}
									</span>
									<div className="flex items-center gap-1.5">
										{stats.created > 0 && (
											<Badge
												variant="secondary"
												className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
											>
												+{stats.created} created
											</Badge>
										)}
										{stats.skipped > 0 && (
											<Badge variant="outline" className="text-muted-foreground">
												{stats.skipped} skipped
											</Badge>
										)}
										{Boolean(stats.flaggedDuplicate && stats.flaggedDuplicate > 0) && (
											<Badge
												variant="destructive"
												className="bg-amber-500/10 text-amber-600 dark:text-amber-400"
											>
												{stats.flaggedDuplicate} flagged duplicate
											</Badge>
										)}
										{stats.created === 0 &&
											stats.skipped === 0 &&
											!stats.flaggedDuplicate && (
												<span className="text-xs text-muted-foreground">0 processed</span>
											)}
									</div>
								</div>
							))}

						{importResult && importResult.skippedReasons.length > 0 && (
							<div className="mt-2 rounded-lg bg-muted/50 p-3 text-xs">
								<div className="font-medium mb-1 text-foreground">
									Skipped or Flagged Details:
								</div>
								<ul className="list-disc pl-4 space-y-1 text-muted-foreground">
									{importResult.skippedReasons.slice(0, 5).map((r, i) => (
										<li key={i}>
											<span className="font-medium capitalize">{r.entity}</span>
											{r.identifier ? ` "${r.identifier}"` : ''}:{' '}
											{r.reason === 'already-exists'
												? 'already exists in app'
												: 'unresolved relationship reference'}
										</li>
									))}
									{importResult.skippedReasons.length > 5 && (
										<li>...and {importResult.skippedReasons.length - 5} more items</li>
									)}
								</ul>
							</div>
						)}
					</div>

					<DialogFooter>
						<Button type="button" onClick={() => setImportResult(null)}>
							Done
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
