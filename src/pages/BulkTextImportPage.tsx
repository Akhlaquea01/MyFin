import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '../components/ui/select';
import { useSession } from '../context/SessionContext';
import { AccountRepository } from '../data/dexie/accountRepository';
import { importBulkText, type ImportResult } from '../data/io/bulkTextImportService';
import type { Account } from '../domain/entities';

// User Story 4 (P4): bulk import of exported SMS/notification text (FR-019).
export function BulkTextImportPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [accountId, setAccountId] = useState('');
	const [result, setResult] = useState<ImportResult | null>(null);
	const [importing, setImporting] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		void AccountRepository.list(key, false).then(setAccounts);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file || !accountId) {
			if (!accountId) toast.error('Choose an account first.');
			return;
		}
		setImporting(true);
		try {
			const text = await file.text();
			const importResult = await importBulkText(key, text, accountId);
			setResult(importResult);
		} finally {
			setImporting(false);
			if (fileInputRef.current) fileInputRef.current.value = '';
		}
	}

	return (
		<div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
			<h1 className="mb-6 text-2xl font-semibold tracking-tight">Bulk Text Import</h1>

			<Card>
				<CardContent className="flex flex-col gap-4 pt-6">
					<p className="text-sm text-muted-foreground">
						Import a plain-text file with one payment notification per line (e.g. exported from an
						SMS backup app).
					</p>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="bti-account">Account</Label>
						<Select value={accountId} onValueChange={setAccountId}>
							<SelectTrigger id="bti-account" className="w-full">
								<SelectValue placeholder="Choose account…" />
							</SelectTrigger>
							<SelectContent>
								{accounts.map((a) => (
									<SelectItem key={a.id} value={a.id}>
										{a.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<Button
						type="button"
						disabled={!accountId || importing}
						onClick={() => fileInputRef.current?.click()}
					>
						<Upload /> {importing ? 'Importing…' : 'Choose file…'}
					</Button>
					<input
						ref={fileInputRef}
						type="file"
						accept=".txt,text/plain"
						className="hidden"
						onChange={handleFileChange}
					/>
				</CardContent>
			</Card>

			{result && (
				<Card className="mt-6">
					<CardContent className="flex flex-col gap-3 pt-6">
						<p className="text-sm">
							Created <strong>{result.createdCount}</strong> unreviewed transaction
							{result.createdCount === 1 ? '' : 's'}.
						</p>
						{result.flaggedDuplicates.length > 0 && (
							<p className="text-sm text-amber-600 dark:text-amber-400">
								{result.flaggedDuplicates.length} flagged as possible duplicates.
							</p>
						)}
						{result.skippedMalformedRows.length > 0 && (
							<div>
								<p className="mb-1 text-sm text-muted-foreground">
									{result.skippedMalformedRows.length} line
									{result.skippedMalformedRows.length === 1 ? '' : 's'} couldn't be read:
								</p>
								<ul className="list-inside list-disc text-xs text-muted-foreground">
									{result.skippedMalformedRows.map((row) => (
										<li key={row.rowNumber}>
											Line {row.rowNumber}: {row.reason}
										</li>
									))}
								</ul>
							</div>
						)}
						<Button asChild variant="outline">
							<Link to="/review">Go to review queue</Link>
						</Button>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
