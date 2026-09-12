import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '../components/ui/select';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow
} from '../components/ui/table';
import { useSession } from '../context/SessionContext';
import { AccountRepository } from '../data/dexie/accountRepository';
import {
	parseCsv,
	parseXlsx,
	previewRows,
	importRows,
	resolveAccountForRow,
	findAccountNameCollisions,
	MAX_IMPORT_ROWS,
	type ColumnMapping,
	type ParsedFile,
	type ImportResult
} from '../data/io/importService';
import type { Account } from '../domain/entities';

const NONE = '__none__';

// User Story 9 (P9): CSV/XLSX import with interactive column mapping (FR-037, FR-038).
export function ImportPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [accountId, setAccountId] = useState('');
	const [accountColumn, setAccountColumn] = useState(NONE);
	const [parsed, setParsed] = useState<ParsedFile | null>(null);
	const [dateColumn, setDateColumn] = useState('');
	const [dateFormat, setDateFormat] = useState('YYYY-MM-DD');
	const [amountColumn, setAmountColumn] = useState('');
	const [descriptionColumn, setDescriptionColumn] = useState(NONE);
	const [signConvention, setSignConvention] =
		useState<ColumnMapping['amountSignConvention']>('negative-is-expense');
	const [debitColumn, setDebitColumn] = useState('');
	const [creditColumn, setCreditColumn] = useState('');
	const [importing, setImporting] = useState(false);
	const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
	const [result, setResult] = useState<ImportResult | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		// Includes archived accounts: they're valid destinations for column-based resolution
		// (FR-003), even though the plain fallback picker below must stay active-only.
		void AccountRepository.list(key, true).then(setAccounts);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	const activeAccounts = accounts.filter((a) => !a.isArchived);

	// Whole-file collision pre-check (FR-006), recomputed whenever the file or the account
	// column selection changes — mirrors the check importRows() itself performs, surfaced
	// early so the user isn't left waiting for a throw.
	const accountNameCollisions =
		accountColumn !== NONE && parsed
			? findAccountNameCollisions(
					parsed.rows.map((r) => r[accountColumn] ?? ''),
					accounts
				)
			: [];

	async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file) return;
		setResult(null);
		setProgress(null);
		try {
			const isXlsx = file.name.toLowerCase().endsWith('.xlsx');
			const parsedFile = isXlsx
				? await parseXlsx(await file.arrayBuffer())
				: parseCsv(await file.text());
			if (parsedFile.rows.length > MAX_IMPORT_ROWS) {
				toast.error(
					`That file has ${parsedFile.rows.length.toLocaleString()} rows. ` +
						`Split it into files of ${MAX_IMPORT_ROWS.toLocaleString()} rows or fewer.`
				);
				return;
			}
			setParsed(parsedFile);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not read that file.');
			return;
		}
		// No column is pre-guessed: a wrong guess here would misfile every amount as the
		// wrong sign or category, so the user always picks each mapping explicitly (same
		// reasoning as the New Transaction form's account field).
		setDateColumn('');
		setAmountColumn('');
		setDescriptionColumn(NONE);
		setAccountColumn(NONE);
	}

	async function handleImport() {
		const hasAccountColumn = accountColumn !== NONE;
		if (!parsed || !dateColumn || !dateFormat) return;
		if (!hasAccountColumn && !accountId) return;
		if (signConvention === 'negative-is-expense' && !amountColumn) return;
		if (signConvention === 'separate-debit-credit-columns' && (!debitColumn || !creditColumn))
			return;
		if (accountNameCollisions.length > 0) return;

		const mapping: ColumnMapping = {
			dateColumn,
			amountColumn,
			descriptionColumn: descriptionColumn === NONE ? undefined : descriptionColumn,
			accountId,
			accountColumn: hasAccountColumn ? accountColumn : undefined,
			dateFormat,
			amountSignConvention: signConvention,
			debitColumn: signConvention === 'separate-debit-credit-columns' ? debitColumn : undefined,
			creditColumn: signConvention === 'separate-debit-credit-columns' ? creditColumn : undefined
		};

		setImporting(true);
		setProgress({ done: 0, total: parsed.rows.length });
		try {
			const importResult = await importRows(key, parsed.rows, mapping, accounts, (done, total) =>
				setProgress({ done, total })
			);
			setResult(importResult);
			toast.success(`Imported ${importResult.createdCount} transaction(s)`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not import file.');
		} finally {
			setImporting(false);
			setProgress(null);
		}
	}

	const canImport =
		!!parsed &&
		(accountColumn !== NONE || !!accountId) &&
		accountNameCollisions.length === 0 &&
		!!dateColumn &&
		!!dateFormat &&
		(signConvention === 'negative-is-expense' ? !!amountColumn : !!debitColumn && !!creditColumn);

	return (
		<div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
			<h1 className="mb-6 text-2xl font-semibold tracking-tight">Import Transactions</h1>

			<Card>
				<CardContent className="flex flex-col gap-4 pt-6">
					<p className="text-sm text-muted-foreground">
						Import a CSV or XLSX file. Map its columns below — nothing is imported until you
						confirm.
					</p>
					<Button
						type="button"
						variant="outline"
						className="w-fit"
						onClick={() => fileInputRef.current?.click()}
					>
						<Upload /> Choose file…
					</Button>
					<input
						ref={fileInputRef}
						type="file"
						accept=".csv,.xlsx,text/csv"
						className="hidden"
						onChange={(e) => void handleFileChange(e)}
					/>

					{parsed && (
						<>
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="import-account">
										Account{accountColumn !== NONE ? ' (fallback, not used)' : ''}
									</Label>
									<Select
										value={accountId}
										onValueChange={setAccountId}
										disabled={accountColumn !== NONE}
									>
										<SelectTrigger id="import-account" className="w-full">
											<SelectValue placeholder="Choose account…" />
										</SelectTrigger>
										<SelectContent>
											{activeAccounts.map((a) => (
												<SelectItem key={a.id} value={a.id}>
													{a.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="import-account-col">Account column (optional)</Label>
									<Select value={accountColumn} onValueChange={setAccountColumn}>
										<SelectTrigger id="import-account-col" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value={NONE}>None - use selected account</SelectItem>
											{parsed.headers.map((h) => (
												<SelectItem key={h} value={h}>
													{h}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									{accountColumn !== NONE && (
										<p className="text-xs text-muted-foreground">
											Account will be read from the "{accountColumn}" column per row (including
											archived accounts).
										</p>
									)}
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="import-date-format">Date format</Label>
									<Input
										id="import-date-format"
										value={dateFormat}
										onChange={(e) => setDateFormat(e.target.value)}
										placeholder="DD/MM/YYYY"
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="import-date-col">Date column</Label>
									<Select value={dateColumn} onValueChange={setDateColumn}>
										<SelectTrigger id="import-date-col" className="w-full">
											<SelectValue placeholder="Choose column…" />
										</SelectTrigger>
										<SelectContent>
											{parsed.headers.map((h) => (
												<SelectItem key={h} value={h}>
													{h}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="import-desc-col">Description column (optional)</Label>
									<Select value={descriptionColumn} onValueChange={setDescriptionColumn}>
										<SelectTrigger id="import-desc-col" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value={NONE}>None</SelectItem>
											{parsed.headers.map((h) => (
												<SelectItem key={h} value={h}>
													{h}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="col-span-2 flex flex-col gap-1.5">
									<Label htmlFor="import-sign">Amount convention</Label>
									<Select
										value={signConvention}
										onValueChange={(v) =>
											setSignConvention(v as ColumnMapping['amountSignConvention'])
										}
									>
										<SelectTrigger id="import-sign" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="negative-is-expense">
												Single amount column (negative = expense)
											</SelectItem>
											<SelectItem value="separate-debit-credit-columns">
												Separate debit/credit columns
											</SelectItem>
										</SelectContent>
									</Select>
								</div>
								{signConvention === 'negative-is-expense' ? (
									<div className="col-span-2 flex flex-col gap-1.5">
										<Label htmlFor="import-amount-col">Amount column</Label>
										<Select value={amountColumn} onValueChange={setAmountColumn}>
											<SelectTrigger id="import-amount-col" className="w-full">
												<SelectValue placeholder="Choose column…" />
											</SelectTrigger>
											<SelectContent>
												{parsed.headers.map((h) => (
													<SelectItem key={h} value={h}>
														{h}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								) : (
									<>
										<div className="flex flex-col gap-1.5">
											<Label htmlFor="import-debit-col">Debit column</Label>
											<Select value={debitColumn} onValueChange={setDebitColumn}>
												<SelectTrigger id="import-debit-col" className="w-full">
													<SelectValue placeholder="Choose column…" />
												</SelectTrigger>
												<SelectContent>
													{parsed.headers.map((h) => (
														<SelectItem key={h} value={h}>
															{h}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
										<div className="flex flex-col gap-1.5">
											<Label htmlFor="import-credit-col">Credit column</Label>
											<Select value={creditColumn} onValueChange={setCreditColumn}>
												<SelectTrigger id="import-credit-col" className="w-full">
													<SelectValue placeholder="Choose column…" />
												</SelectTrigger>
												<SelectContent>
													{parsed.headers.map((h) => (
														<SelectItem key={h} value={h}>
															{h}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									</>
								)}
							</div>

							{accountNameCollisions.length > 0 && (
								<div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
									<p className="text-xs font-medium text-destructive">
										Account name "{accountNameCollisions[0]}" matches more than one account.
										Rename one of them before importing.
									</p>
								</div>
							)}
							{parsed.errors.length > 0 && (
								<div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
									<p className="text-xs font-medium text-destructive">
										{parsed.errors.length} line{parsed.errors.length === 1 ? '' : 's'} in this file
										couldn't be parsed cleanly. Check the preview before importing.
									</p>
									<ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
										{parsed.errors.slice(0, 5).map((e, i) => (
											<li key={i}>
												Row {e.row}: {e.message}
											</li>
										))}
									</ul>
								</div>
							)}
							{parsed.rows.length > 0 && (
								<div>
									<p className="mb-2 text-xs text-muted-foreground">Preview (first 5 rows)</p>
									<Table>
										<TableHeader>
											<TableRow>
												{parsed.headers.map((h) => (
													<TableHead key={h}>{h}</TableHead>
												))}
												{accountColumn !== NONE && <TableHead>Account (resolved)</TableHead>}
											</TableRow>
										</TableHeader>
										<TableBody>
											{previewRows(parsed).map((row, i) => (
												<TableRow key={i}>
													{parsed.headers.map((h) => (
														<TableCell key={h}>{row[h]}</TableCell>
													))}
													{accountColumn !== NONE &&
														(() => {
															const resolvedAccount = resolveAccountForRow(
																row[accountColumn] ?? '',
																accounts
															);
															const raw = row[accountColumn]?.trim();
															return (
																<TableCell>
																	{resolvedAccount
																		? `✅ ${resolvedAccount.name}`
																		: raw
																			? `❌ ${raw} (not found)`
																			: '❌ Empty'}
																</TableCell>
															);
														})()}
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							)}

							<Button type="button" disabled={!canImport || importing} onClick={handleImport}>
								{importing
									? progress
										? `Importing ${progress.done.toLocaleString()}/${progress.total.toLocaleString()}…`
										: 'Importing…'
									: `Import ${parsed.rows.length} row(s)`}
							</Button>
						</>
					)}
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
						{result.perAccountSummary &&
							Object.keys(result.perAccountSummary).length > 1 && (
								<div>
									<p className="mb-1 text-sm font-medium">Imported by account:</p>
									<ul className="list-inside list-disc text-xs text-muted-foreground">
										{Object.entries(result.perAccountSummary).map(([accId, summary]) => (
											<li key={accId}>
												{summary.count} to {summary.accountName}
											</li>
										))}
									</ul>
								</div>
							)}
						{result.skippedMalformedRows.length > 0 && (
							<div>
								<p className="mb-1 text-sm text-muted-foreground">
									{result.skippedMalformedRows.length} row
									{result.skippedMalformedRows.length === 1 ? '' : 's'} couldn't be read:
								</p>
								<ul className="list-inside list-disc text-xs text-muted-foreground">
									{result.skippedMalformedRows.map((row) => (
										<li key={row.rowNumber}>
											Row {row.rowNumber}: {row.reason}
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
