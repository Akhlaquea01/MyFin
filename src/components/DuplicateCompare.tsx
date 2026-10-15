import { CopyIcon } from 'lucide-react';
import { Button } from './ui/button';
import type { DuplicateReason } from '../domain/transactions/duplicateCandidates';
import type { Merchant, Transaction } from '../domain/entities';
import { formatTransactionLabel } from '../domain/transactions/transactionLabel';
import { formatMoney } from '../domain/shared/money';

const REASON_TEXT: Record<DuplicateReason, string> = {
	'same-reference': 'Same bank reference number, so this is almost certainly the same payment.',
	'same-merchant': 'Same amount and merchant within a day.',
	'same-amount': 'Same amount within a day. It could still be a separate purchase.'
};

/**
 * Shown under a Review entry that may be a second copy of something already filed: the entry it
 * looks like, why, and the two ways out. Keeping both is a one-tap "no, they are separate"; removing
 * this one discards it with the usual Undo.
 */
export function DuplicateCompare({
	original,
	reason,
	merchants,
	accountLabel,
	busy,
	onKeepBoth,
	onRemoveThis
}: {
	original: Transaction;
	reason: DuplicateReason;
	merchants: Merchant[];
	/** Only given when the other entry is on a different account, which is worth saying. */
	accountLabel: string | null;
	busy: boolean;
	onKeepBoth: () => void;
	onRemoveThis: () => void;
}) {
	const waiting = original.reviewStatus === 'unreviewed';
	return (
		<div
			data-testid="duplicate-compare"
			className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3"
		>
			<p className="flex items-center gap-1.5 text-sm font-medium">
				<CopyIcon className="size-4 text-warning" aria-hidden /> Looks like one you already have
			</p>
			<div className="rounded-md bg-background/60 p-2 text-xs">
				<div className="flex items-baseline justify-between gap-2">
					<span className="truncate font-medium">
						{formatTransactionLabel(original, merchants)}
					</span>
					<span className={`font-mono ${original.amount < 0 ? 'text-expense' : 'text-income'}`}>
						{formatMoney(original.amount)}
					</span>
				</div>
				<p className="text-muted-foreground">
					{original.date}
					{accountLabel ? ` · ${accountLabel}` : ''} · {waiting ? 'waiting in Review' : 'confirmed'}
				</p>
			</div>
			<p className="text-xs text-muted-foreground">{REASON_TEXT[reason]}</p>
			<div className="flex flex-wrap gap-2">
				<Button type="button" size="sm" variant="outline" disabled={busy} onClick={onKeepBoth}>
					Keep both
				</Button>
				<Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRemoveThis}>
					Same payment — remove this one
				</Button>
			</div>
		</div>
	);
}
