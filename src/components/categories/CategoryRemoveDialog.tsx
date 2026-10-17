import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '../ui/dialog';
import { CategoryPicker } from '../CategoryPicker';
import { UNCATEGORIZED_CATEGORY_ID } from '../../data/dexie/transactionRepository';
import { categoryWithDescendantIds } from '../../domain/categories/categoryHierarchy';
import type { CategoryReferenceCounts } from '../../domain/categories/categoryEngine';
import type { Category } from '../../domain/entities';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Removing or merging a category that has things attached to it. Nothing is thrown away silently:
 * the user says where its transactions go, and the budget and rules follow them. Used for both
 * "Delete" (the default destination is Uncategorized) and "Merge into…" (a category must be chosen,
 * and the subcategories move too).
 */
export function CategoryRemoveDialog({
	category,
	mode,
	categories,
	references,
	onOpenChange,
	onConfirm
}: {
	category: Category;
	mode: 'delete' | 'merge';
	categories: Category[];
	references: CategoryReferenceCounts;
	onOpenChange: (open: boolean) => void;
	/** The chosen destination: a category id, or null for Uncategorized. */
	onConfirm: (destinationId: string | null) => Promise<void>;
}) {
	const merging = mode === 'merge';
	const [destination, setDestination] = useState(merging ? '' : UNCATEGORIZED_CATEGORY_ID);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setDestination(merging ? '' : UNCATEGORIZED_CATEGORY_ID);
		setError(null);
		setBusy(false);
	}, [category.id, merging]);

	// Anything but the category itself and what is inside it.
	const choices = useMemo(() => {
		const inside = new Set(categoryWithDescendantIds(categories, category.id));
		return categories.filter((c) => !inside.has(c.id));
	}, [categories, category.id]);

	const subcategories = categories.filter((c) => c.parentId === category.id).length;
	const toUncategorized = destination === UNCATEGORIZED_CATEGORY_ID;
	const target = categories.find((c) => c.id === destination);

	const things: string[] = [];
	if (references.splits > 0) things.push(plural(references.splits, 'transaction', 'transactions'));
	if (references.budgets > 0) things.push('its budget');
	if (references.recurring > 0) {
		things.push(plural(references.recurring, 'recurring rule', 'recurring rules'));
	}
	if (references.rules > 0)
		things.push(plural(references.rules, 'auto-categorize rule', 'auto-categorize rules'));
	if (subcategories > 0 && merging) {
		things.push(plural(subcategories, 'subcategory', 'subcategories'));
	}

	async function confirm() {
		setBusy(true);
		setError(null);
		try {
			await onConfirm(toUncategorized || !destination ? null : destination);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not complete this.');
			setBusy(false);
		}
	}

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{merging ? `Merge ${category.name} into another category` : `Remove ${category.name}`}
					</DialogTitle>
					<DialogDescription>
						{things.length > 0 ? (
							<>
								{merging ? 'Moves ' : 'Has '}
								{things.join(', ')}
								{merging ? ' to the category you choose, then removes this one.' : '.'}
							</>
						) : (
							'Nothing is filed under it.'
						)}
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="remove-destination">
						{merging ? 'Merge into' : 'Move what is filed under it to'}
					</Label>
					<CategoryPicker
						id="remove-destination"
						value={destination}
						onChange={setDestination}
						categories={choices}
						placeholder="Choose a category…"
						noneOption={
							merging ? undefined : { value: UNCATEGORIZED_CATEGORY_ID, label: 'Uncategorized' }
						}
					/>
					{!merging && toUncategorized && (references.budgets > 0 || references.rules > 0) && (
						<p className="text-xs text-muted-foreground">
							A budget or auto-categorize rule for Uncategorized would never apply, so{' '}
							{references.budgets > 0 && references.rules > 0
								? 'they are'
								: references.budgets > 0
									? 'the budget is'
									: 'the rules are'}{' '}
							removed. Choose a category to keep {references.budgets > 0 ? 'it' : 'them'}.
						</p>
					)}
					{merging && target && references.budgets > 0 && (
						<p className="text-xs text-muted-foreground">
							If {target.name} already has a budget, its budget is kept and this one is dropped.
						</p>
					)}
					{error && <p className="text-sm text-destructive">{error}</p>}
				</div>

				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						type="button"
						variant="destructive"
						disabled={busy || (merging && !destination)}
						onClick={() => void confirm()}
					>
						{merging ? 'Merge categories' : 'Remove category'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
