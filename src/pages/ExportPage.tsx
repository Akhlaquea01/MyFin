import { useState } from 'react';
import { saveAs } from 'file-saver';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { useSession } from '../context/SessionContext';
import { buildExportRows, exportToCsvBlob, exportToXlsxBlob } from '../data/io/exportService';

// User Story 9 (P9): export transactions to common formats (FR-039).
export function ExportPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);

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

	return (
		<div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
			<h1 className="mb-6 text-2xl font-semibold tracking-tight">Export Transactions</h1>
			<Card>
				<CardContent className="flex flex-col gap-4 pt-6">
					<p className="text-sm text-muted-foreground">
						Export every transaction — date, account, categories, amount, and notes — to a file you
						can open elsewhere.
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
		</div>
	);
}
