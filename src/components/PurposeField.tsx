import { useEffect, useMemo, useState } from 'react';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useSession } from '../context/SessionContext';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import { RecurringRepository } from '../data/dexie/recurringRepository';
import { SavingsGoalRepository } from '../data/dexie/savingsGoalRepository';
import { InvestmentHoldingRepository, LiabilityRepository } from '../data/dexie/wealthRepository';
import { buildCategoryLabels } from '../domain/categories/categoryHierarchy';
import {
	PURPOSE_KINDS,
	PURPOSE_LABELS,
	TARGET_NOUN,
	purposeNeedsTarget
} from '../domain/transactions/purposeEngine';
import { formatMoney } from '../domain/shared/money';
import type { PurposeKind, TransactionPurpose } from '../domain/entities';

interface TargetOption {
	id: string;
	label: string;
}

type Targets = Record<PurposeKind, TargetOption[]>;

const NO_PURPOSE = '__none__';
const NO_TARGET = '__no_item__';

const KIND_HELP: Record<PurposeKind, string> = {
	debt: 'Lowers the balance owed on this debt. Like a payment made on the Liabilities page, the entry is then managed there: undo the payment to change it.',
	savings:
		'Added to the goal as a contribution, and kept in step if you edit or delete this entry.',
	investment:
		'Marked as an investment. To record units bought or sold, use Buy more units on the Investments page.',
	bills: 'Marks the nearest unpaid payment of that bill as paid.'
};

// Review draws a field per waiting entry, so the lists are read once and shared for a few seconds
// instead of once per field. Short enough that a debt or goal added a moment ago still shows up.
const TARGETS_TTL_MS = 3000;
let targetsCache: { key: CryptoKey; at: number; promise: Promise<Targets> } | null = null;

function loadTargets(key: CryptoKey): Promise<Targets> {
	const now = Date.now();
	if (targetsCache && targetsCache.key === key && now - targetsCache.at < TARGETS_TTL_MS) {
		return targetsCache.promise;
	}
	const promise = (async (): Promise<Targets> => {
		const [liabilities, goals, rules, holdings, categories] = await Promise.all([
			LiabilityRepository.list(key),
			SavingsGoalRepository.list(key),
			RecurringRepository.listActive(key),
			InvestmentHoldingRepository.list(key),
			CategoryRepository.list(key)
		]);
		const categoryLabels = buildCategoryLabels(categories);
		return {
			// A card tracked as an account is paid with "Pay bill", and a paid-off debt has nothing left.
			debt: liabilities
				.filter((l) => !l.linkedAccountId && l.outstandingBalance > 0)
				.map((l) => ({ id: l.id, label: `${l.name} · ${formatMoney(l.outstandingBalance)} owed` })),
			savings: goals.map((g) => ({ id: g.id, label: g.name })),
			investment: holdings.map((h) => ({ id: h.id, label: h.name })),
			bills: rules
				.filter((r) => r.amount < 0)
				.map((r) => ({
					id: r.id,
					label: `${r.label || categoryLabels.get(r.categoryId) || 'Bill'} · ${formatMoney(
						Math.abs(r.amount)
					)} ${r.frequency}`
				}))
		};
	})();
	targetsCache = { key, at: now, promise };
	// A failed read must not be served again for the next few seconds.
	promise.catch(() => {
		if (targetsCache?.promise === promise) targetsCache = null;
	});
	return promise;
}

/**
 * "What was this for?" — marks an expense as a debt payment, savings, an investment or a bill, and
 * says which one. Shared by every place an entry is created or edited. The effect on the debt, goal
 * or bill is applied by the transaction engine when the entry is saved (or confirmed); this only
 * collects the choice.
 */
export function PurposeField({
	value,
	onChange,
	disabled,
	idPrefix = 'purpose',
	hintText
}: {
	value: TransactionPurpose | null;
	onChange: (value: TransactionPurpose | null) => void;
	disabled?: boolean;
	idPrefix?: string;
	/** Free text (merchant, notes) to look for the name of a debt, goal or bill in. */
	hintText?: string;
}) {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const [targets, setTargets] = useState<Targets | null>(null);

	useEffect(() => {
		let cancelled = false;
		loadTargets(key)
			.then((loaded) => {
				if (!cancelled) setTargets(loaded);
			})
			.catch(() => {
				if (!cancelled) setTargets({ debt: [], savings: [], investment: [], bills: [] });
			});
		return () => {
			cancelled = true;
		};
	}, [key]);

	// A name the user typed that matches one of their own debts, goals or bills.
	const suggestion = useMemo(() => {
		const text = hintText?.trim().toLowerCase();
		if (value || !targets || !text || text.length < 3) return null;
		for (const kind of PURPOSE_KINDS) {
			if (kind === 'investment') continue;
			for (const option of targets[kind]) {
				const name = option.label.split(' · ')[0].trim().toLowerCase();
				if (name.length >= 3 && (text.includes(name) || name.includes(text))) {
					return { kind, option };
				}
			}
		}
		return null;
	}, [value, targets, hintText]);

	const kindOptions = value ? (targets?.[value.kind] ?? []) : [];
	const targetOptional = value ? !purposeNeedsTarget(value.kind) : true;

	return (
		<div className="flex flex-col gap-2">
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${idPrefix}-kind`}>Purpose</Label>
					<Select
						value={value?.kind ?? NO_PURPOSE}
						onValueChange={(next) =>
							onChange(next === NO_PURPOSE ? null : { kind: next as PurposeKind, targetId: null })
						}
						disabled={disabled}
					>
						<SelectTrigger id={`${idPrefix}-kind`} className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={NO_PURPOSE}>None</SelectItem>
							{PURPOSE_KINDS.map((kind) => (
								<SelectItem key={kind} value={kind}>
									{PURPOSE_LABELS[kind]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{value && (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${idPrefix}-target`}>Linked item</Label>
						<Select
							value={value.targetId ?? NO_TARGET}
							onValueChange={(next) =>
								onChange({ kind: value.kind, targetId: next === NO_TARGET ? null : next })
							}
							disabled={disabled || targets === null}
						>
							<SelectTrigger id={`${idPrefix}-target`} className="w-full">
								<SelectValue placeholder={`Choose a ${TARGET_NOUN[value.kind]}…`} />
							</SelectTrigger>
							<SelectContent>
								{targetOptional && (
									<SelectItem value={NO_TARGET}>
										{value.kind === 'bills' ? 'Match automatically' : 'No specific item'}
									</SelectItem>
								)}
								{kindOptions.map((option) => (
									<SelectItem key={option.id} value={option.id}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				)}
			</div>

			{value && (
				<p className="text-xs text-muted-foreground">
					{KIND_HELP[value.kind]}
					{targets && kindOptions.length === 0 && purposeNeedsTarget(value.kind)
						? ` You have no ${TARGET_NOUN[value.kind]} yet to link this to.`
						: ''}
				</p>
			)}

			{suggestion && (
				<p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<span>
						This looks like {PURPOSE_LABELS[suggestion.kind].toLowerCase()}:{' '}
						<strong>{suggestion.option.label.split(' · ')[0]}</strong>.
					</span>
					<Button
						type="button"
						variant="outline"
						size="xs"
						disabled={disabled}
						onClick={() => onChange({ kind: suggestion.kind, targetId: suggestion.option.id })}
					>
						Use this
					</Button>
				</p>
			)}
		</div>
	);
}
