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
import { findCardMatches, type CardMatch } from '../domain/parser/cardIdentifierMatcher';
import type { Account } from '../domain/entities';

// User Story 4 (P4): bulk import of exported SMS/notification text (FR-019).
// Spec 017, User Story 5: detects a tagged credit card's identifier in the pasted/uploaded text
// and pre-selects it as the destination, asking the user to disambiguate when more than one
// tagged card matches (FR-020/FR-022/FR-023).
export function BulkTextImportPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [accountId, setAccountId] = useState('');
	const [pendingText, setPendingText] = useState<string | null>(null);
	const [pendingLineCount, setPendingLineCount] = useState(0);
	const [matchReason, setMatchReason] = useState<CardMatch | null>(null);
	const [ambiguousMatches, setAmbiguousMatches] = useState<CardMatch[] | null>(null);
	const [result, setResult] = useState<ImportResult | null>(null);
	const [importing, setImporting] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		void AccountRepository.list(key, false).then(setAccounts);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function resetPending() {
		setPendingText(null);
		setPendingLineCount(0);
		setMatchReason(null);
		setAmbiguousMatches(null);
	}

	async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file) return;
		setResult(null);
		resetPending();
		const text = await file.text();
		const lineCount = text.split(/\r?\n/).filter((l) => l.trim()).length;

		// FR-020/FR-022/FR-023: detect a tagged card's identifier across the whole file before
		// asking the user to confirm anything.
		const matches = findCardMatches(text, accounts);
		const distinctAccountIds = [...new Set(matches.map((m) => m.accountId))];
		if (distinctAccountIds.length === 1) {
			setAccountId(distinctAccountIds[0]);
			setMatchReason(matches.find((m) => m.accountId === distinctAccountIds[0]) ?? null);
		} else if (distinctAccountIds.length > 1) {
			// One entry per distinct matched account, for the disambiguation control below.
			const uniqueByAccount = distinctAccountIds.map((id) =>
				matches.find((m) => m.accountId === id)!
			);
			setAmbiguousMatches(uniqueByAccount);
			setAccountId('');
		}

		setPendingText(text);
		setPendingLineCount(lineCount);
		if (fileInputRef.current) fileInputRef.current.value = '';
	}

	async function handleImport() {
		if (!pendingText || !accountId) {
			if (!accountId) toast.error('Choose an account first.');
			return;
		}
		setImporting(true);
		try {
			const importResult = await importBulkText(key, pendingText, accountId, accounts);
			setResult(importResult);
			resetPending();
		} finally {
			setImporting(false);
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
						accept=".txt,text/plain"
						className="hidden"
						onChange={(e) => void handleFileChange(e)}
					/>

					{pendingText !== null && (
						<>
							{matchReason && (
								<p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs text-muted-foreground">
									Matched by {matchReason.matchType === 'last4' ? 'card ending' : 'nickname'} "
									{matchReason.matchedIdentifier}" — destination pre-selected below. You can still
									choose a different account.
								</p>
							)}
							{ambiguousMatches && (
								<div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
									<p className="text-xs text-muted-foreground">
										This text matches more than one tagged card — pick which one:
									</p>
									<div className="flex flex-wrap gap-2">
										{ambiguousMatches.map((match) => (
											<Button
												key={match.accountId}
												type="button"
												variant={accountId === match.accountId ? 'default' : 'outline'}
												size="sm"
												className="h-auto py-1"
												onClick={() => setAccountId(match.accountId)}
											>
												{match.accountName} (ending {match.matchedIdentifier})
											</Button>
										))}
									</div>
								</div>
							)}
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="bti-account">
									Account{matchReason ? ' (detected — override if needed)' : ''}
								</Label>
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
								onClick={() => void handleImport()}
							>
								{importing ? 'Importing…' : `Import ${pendingLineCount} line(s)`}
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
