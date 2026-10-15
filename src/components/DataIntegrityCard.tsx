import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { useSession } from '../context/SessionContext';
import {
	checkIntegrity,
	describeIntegrityIssue,
	repairBalances,
	type IntegrityReport
} from '../data/io/integrityService';

/** How many problems to spell out; the rest are counted. A damaged ledger can have thousands. */
const MAX_LISTED_ISSUES = 8;

/**
 * "Check my data": re-derives every account balance from its entries and looks for entries that
 * contradict themselves. Reads only; the one fix on offer rebuilds balances, which are derived.
 */
export function DataIntegrityCard() {
	const { getEncryptionKey } = useSession();
	const [busy, setBusy] = useState(false);
	const [report, setReport] = useState<IntegrityReport | null>(null);

	async function run(action: 'check' | 'repair') {
		setBusy(true);
		try {
			const key = getEncryptionKey();
			if (action === 'repair') {
				const fixed = await repairBalances(key);
				toast.success(`Rebuilt ${fixed} account balance${fixed === 1 ? '' : 's'}.`);
			}
			setReport(await checkIntegrity(key));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not check your data.');
		} finally {
			setBusy(false);
		}
	}

	const balanceProblems = report?.issues.filter((i) => i.kind === 'balance-mismatch').length ?? 0;
	const otherProblems = (report?.issues.length ?? 0) - balanceProblems;

	return (
		<Card className="mb-6">
			<CardHeader>
				<CardTitle className="text-base">Check my data</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<p className="text-sm text-muted-foreground">
					Re-adds every account from its entries and looks for anything that doesn’t agree with
					itself, such as a transfer missing its other half. Nothing is changed unless you choose to
					rebuild the balances.
				</p>
				<div>
					<Button type="button" variant="outline" disabled={busy} onClick={() => void run('check')}>
						<ShieldCheck /> {busy ? 'Checking…' : 'Check now'}
					</Button>
				</div>

				{report && (
					<div role="status" aria-live="polite" className="flex flex-col gap-2 text-sm">
						{report.issues.length === 0 ? (
							<p>
								All good: {report.checkedTransactions.toLocaleString()} entries checked, every
								balance matches.
							</p>
						) : (
							<>
								<p className="font-medium">
									{report.issues.length} problem{report.issues.length === 1 ? '' : 's'} found in{' '}
									{report.checkedTransactions.toLocaleString()} entries.
								</p>
								<ul className="list-disc space-y-1 pl-5 text-muted-foreground">
									{report.issues.slice(0, MAX_LISTED_ISSUES).map((issue, index) => (
										<li key={index}>{describeIntegrityIssue(issue)}</li>
									))}
								</ul>
								{report.issues.length > MAX_LISTED_ISSUES && (
									<p className="text-muted-foreground">
										…and {report.issues.length - MAX_LISTED_ISSUES} more.
									</p>
								)}
								{balanceProblems > 0 && (
									<div>
										<Button type="button" disabled={busy} onClick={() => void run('repair')}>
											Rebuild balances
										</Button>
									</div>
								)}
								{otherProblems > 0 && (
									<p className="text-xs text-muted-foreground">
										Entries that disagree with themselves are not changed automatically. Make a
										backup first, then edit or delete the entries named above.
									</p>
								)}
							</>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
