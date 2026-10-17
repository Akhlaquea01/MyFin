import { useEffect, useState, type FormEvent } from 'react';
import { cn } from 'cn';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '../ui/dialog';
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle
} from '../ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { MOBILE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import { CATEGORY_COLOR_KEYS } from '../../domain/categories/categoryColor';
import { topLevelOf } from '../../domain/categories/categoryOverview';
import type { Category, CategoryKind } from '../../domain/entities';
import { CATEGORY_ICONS } from './categoryIconSet';
import { CategoryGlyph } from './categoryIcons';

export interface CategoryEditorValues {
	name: string;
	parentId: string | null;
	icon: string | null;
	color: string | null;
	kind: CategoryKind;
}

const NO_PARENT = '__none__';

/**
 * Adding or editing one category. A bottom sheet on a phone (one-handed, and the keyboard rises
 * under it) and a dialog on a desktop — the same switch the category picker makes. The colour and
 * icon are chosen here; a subcategory has no colour of its own and wears its parent's.
 */
export function CategoryEditor({
	open,
	onOpenChange,
	category,
	defaultParentId,
	defaultKind,
	categories,
	onSubmit
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The category being edited; absent when adding. */
	category?: Category;
	/** Pre-selected parent when adding a subcategory. */
	defaultParentId?: string | null;
	/** The list the user is on, so a new category lands in it. */
	defaultKind: CategoryKind;
	categories: Category[];
	onSubmit: (values: CategoryEditorValues) => Promise<void>;
}) {
	const isMobile = useMediaQuery(MOBILE_QUERY);
	const editing = !!category;

	const [name, setName] = useState('');
	const [parentId, setParentId] = useState<string | null>(null);
	const [icon, setIcon] = useState<string | null>(null);
	const [color, setColor] = useState<string | null>(null);
	const [kind, setKind] = useState<CategoryKind>(defaultKind);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	// Start from the category being edited (or empty) every time the editor opens.
	useEffect(() => {
		if (!open) return;
		setName(category?.name ?? '');
		setParentId(category ? category.parentId : (defaultParentId ?? null));
		setIcon(category?.icon ?? null);
		setColor(category?.color ?? null);
		setKind(category?.kind ?? defaultKind);
		setError(null);
		setSaving(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, category?.id]);

	const hasChildren = !!category && categories.some((c) => c.parentId === category.id);
	// A subcategory sits one level under a top-level category, which is as deep as this page goes.
	const parentChoices = topLevelOf(categories).filter((c) => c.id !== category?.id);
	const parent = parentId ? categories.find((c) => c.id === parentId) : undefined;

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (!name.trim()) {
			setError('Category name is required.');
			return;
		}
		setSaving(true);
		try {
			await onSubmit({
				name: name.trim(),
				parentId,
				icon,
				// A subcategory has no colour of its own, so none is kept on it.
				color: parentId ? null : color,
				kind
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not save this category.');
			setSaving(false);
		}
	}

	const title = editing ? 'Edit category' : 'New category';
	const description = editing
		? 'Changes apply everywhere this category is used.'
		: 'Group your spending or income so you can see where the money goes.';

	const form = (
		<form className="flex flex-col gap-4" onSubmit={submit}>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="category-name">Name</Label>
				<Input
					id="category-name"
					value={name}
					autoFocus={!isMobile}
					onChange={(e) => {
						setName(e.target.value);
						setError(null);
					}}
				/>
				{error && <p className="text-sm text-destructive">{error}</p>}
			</div>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor="category-parent">Parent (optional)</Label>
				<Select
					value={parentId ?? NO_PARENT}
					onValueChange={(v) => setParentId(v === NO_PARENT ? null : v)}
					disabled={hasChildren}
				>
					<SelectTrigger id="category-parent" className="w-full">
						<SelectValue placeholder="Top level" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={NO_PARENT}>Top level</SelectItem>
						{parentChoices.map((choice) => (
							<SelectItem key={choice.id} value={choice.id}>
								{choice.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{hasChildren && (
					<p className="text-xs text-muted-foreground">
						It has subcategories, so it stays at the top level.
					</p>
				)}
			</div>

			{!parentId && (
				<div className="flex flex-col gap-1.5">
					<span className="text-sm leading-snug font-medium">Used for</span>
					<div role="radiogroup" aria-label="Used for" className="flex gap-1.5">
						{(['expense', 'income'] as CategoryKind[]).map((option) => (
							<Button
								key={option}
								type="button"
								role="radio"
								aria-checked={kind === option}
								variant={kind === option ? 'secondary' : 'outline'}
								size="sm"
								onClick={() => setKind(option)}
							>
								{option === 'expense' ? 'Spending' : 'Income'}
							</Button>
						))}
					</div>
				</div>
			)}

			<div className="flex flex-col gap-1.5">
				<span className="text-sm leading-snug font-medium">Colour</span>
				{parentId ? (
					<p className="text-xs text-muted-foreground">
						A subcategory uses the colour of {parent?.name ?? 'its parent'}.
					</p>
				) : (
					<div role="radiogroup" aria-label="Colour" className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							role="radio"
							aria-checked={color === null}
							variant={color === null ? 'secondary' : 'outline'}
							size="sm"
							onClick={() => setColor(null)}
						>
							Auto
						</Button>
						{CATEGORY_COLOR_KEYS.map((swatch, index) => (
							<button
								key={swatch}
								type="button"
								role="radio"
								aria-checked={color === swatch}
								aria-label={`Colour ${index + 1}`}
								onClick={() => setColor(swatch)}
								className={cn(
									'size-8 rounded-full ring-offset-2 ring-offset-popover outline-none focus-visible:ring-2 focus-visible:ring-ring',
									color === swatch && 'ring-2 ring-foreground'
								)}
								style={{ backgroundColor: `var(--${swatch})` }}
							/>
						))}
					</div>
				)}
			</div>

			<div className="flex flex-col gap-1.5">
				<span className="text-sm leading-snug font-medium">Icon</span>
				<div
					role="radiogroup"
					aria-label="Icon"
					className="grid grid-cols-6 gap-1.5 sm:grid-cols-8"
				>
					<button
						type="button"
						role="radio"
						aria-checked={icon === null}
						aria-label="No icon"
						onClick={() => setIcon(null)}
						className={cn(
							'flex size-10 items-center justify-center rounded-lg border text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
							icon === null && 'border-foreground bg-muted'
						)}
					>
						None
					</button>
					{CATEGORY_ICONS.map(({ key, label }) => (
						<button
							key={key}
							type="button"
							role="radio"
							aria-checked={icon === key}
							aria-label={`Icon ${label}`}
							onClick={() => setIcon(key)}
							className={cn(
								'flex size-10 items-center justify-center rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring',
								icon === key && 'border-foreground bg-muted'
							)}
						>
							<CategoryGlyph
								icon={key}
								color="var(--foreground)"
								size="sm"
								className="bg-transparent!"
							/>
						</button>
					))}
				</div>
			</div>

			{isMobile ? (
				<SheetFooter className="px-0 pb-[env(safe-area-inset-bottom)]">
					<Button type="submit" disabled={saving}>
						{editing ? 'Save changes' : 'Add category'}
					</Button>
				</SheetFooter>
			) : (
				<DialogFooter>
					<Button type="submit" disabled={saving}>
						{editing ? 'Save changes' : 'Add category'}
					</Button>
				</DialogFooter>
			)}
		</form>
	);

	if (isMobile) {
		return (
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent
					side="bottom"
					className="max-h-[90dvh] overflow-y-auto rounded-t-2xl px-4 pb-4"
				>
					<SheetHeader className="px-0">
						<SheetTitle>{title}</SheetTitle>
						<SheetDescription>{description}</SheetDescription>
					</SheetHeader>
					{form}
				</SheetContent>
			</Sheet>
		);
	}
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{form}
			</DialogContent>
		</Dialog>
	);
}
