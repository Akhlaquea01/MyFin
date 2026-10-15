import { useMemo, useState } from 'react';
import { cn } from 'cn';
import { Command } from 'cmdk';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from './ui/sheet';
import { MOBILE_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { categoryOptions, filterCategoryOptions } from '../domain/categories/categoryHierarchy';
import { buildCategoryColors, categoryColorOf } from '../domain/categories/categoryColor';
import type { Category } from '../domain/entities';

export interface CategoryPickerProps {
	/** Category id, or `noneOption.value`. */
	value: string;
	onChange: (value: string) => void;
	categories: Category[];
	/** Pass the id the label `htmlFor` points at, so the label names the control. */
	id?: string;
	placeholder?: string;
	disabled?: boolean;
	/** "No category" row shown first, e.g. Uncategorized. */
	noneOption?: { value: string; label: string };
	/** Likely categories (a rule or a learned choice), listed first and not repeated below. */
	suggestedIds?: string[];
	className?: string;
}

const ITEM_CLASS =
	'flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm md:min-h-8 md:py-1.5 data-selected:bg-muted';
const GROUP_CLASS =
	'[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground';

/**
 * Pick a category by typing: a search box over the full `Parent › Child` paths, in a popover on a
 * desktop and a bottom sheet on a phone (a floating list is unusable one-handed, and there it
 * opens the keyboard straight away). Replaces the plain dropdown at every category field.
 *
 * The trigger is a `role="combobox"` button whose text is the chosen label, so a `<Label
 * htmlFor>` and screen readers see what a select would have shown.
 */
export function CategoryPicker({
	value,
	onChange,
	categories,
	id,
	placeholder = 'Choose a category…',
	disabled,
	noneOption,
	suggestedIds,
	className
}: CategoryPickerProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const isMobile = useMediaQuery(MOBILE_QUERY);

	const options = useMemo(() => categoryOptions(categories), [categories]);
	const labelById = useMemo(() => new Map(options.map((o) => [o.id, o.label])), [options]);
	const colors = useMemo(() => buildCategoryColors(categories), [categories]);
	const selectedLabel =
		value === noneOption?.value ? noneOption.label : (labelById.get(value) ?? null);

	const visible = useMemo(() => filterCategoryOptions(options, query), [options, query]);
	const suggested = useMemo(() => {
		if (query.trim() !== '') return [];
		const wanted = new Set(suggestedIds ?? []);
		return visible.filter((o) => wanted.has(o.id));
	}, [visible, suggestedIds, query]);
	const rest = useMemo(
		() => visible.filter((o) => !suggested.some((s) => s.id === o.id)),
		[visible, suggested]
	);
	const showNone = !!noneOption && query.trim() === '';

	function handleOpenChange(next: boolean) {
		setOpen(next);
		if (!next) setQuery('');
	}

	function choose(next: string) {
		onChange(next);
		handleOpenChange(false);
	}

	const trigger = (
		<button
			type="button"
			id={id}
			role="combobox"
			aria-expanded={open}
			aria-haspopup="listbox"
			disabled={disabled}
			data-placeholder={selectedLabel === null ? '' : undefined}
			onClick={isMobile ? () => handleOpenChange(true) : undefined}
			className={cn(
				'flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-left text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50',
				className
			)}
		>
			<span className="flex min-w-0 items-center gap-2">
				{selectedLabel !== null && value !== noneOption?.value && (
					<ColorDot color={categoryColorOf(colors, value)} />
				)}
				<span className="line-clamp-1">{selectedLabel ?? placeholder}</span>
			</span>
			<ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
		</button>
	);

	const list = (
		<Command shouldFilter={false} label="Categories" loop>
			<Command.Input
				value={query}
				onValueChange={setQuery}
				placeholder="Type to search categories…"
				autoFocus
				className="w-full border-b bg-transparent px-3 py-3 text-base outline-none placeholder:text-muted-foreground md:py-2.5 md:text-sm"
			/>
			<Command.List className="max-h-[50dvh] overflow-y-auto p-1 md:max-h-72">
				<Command.Empty className="py-6 text-center text-sm text-muted-foreground">
					No category matches “{query.trim()}”.
				</Command.Empty>
				{showNone && (
					<Command.Item
						value={noneOption.value}
						onSelect={() => choose(noneOption.value)}
						className={ITEM_CLASS}
					>
						<span className="flex-1">{noneOption.label}</span>
						{value === noneOption.value && <CheckIcon className="size-4" />}
					</Command.Item>
				)}
				{suggested.length > 0 && (
					<Command.Group heading="Suggested" className={GROUP_CLASS}>
						{suggested.map((o) => (
							<PickerItem
								key={o.id}
								option={o}
								color={categoryColorOf(colors, o.id)}
								selected={o.id === value}
								onPick={choose}
							/>
						))}
					</Command.Group>
				)}
				{rest.length > 0 && (
					<Command.Group
						heading={suggested.length > 0 ? 'All categories' : undefined}
						className={GROUP_CLASS}
					>
						{rest.map((o) => (
							<PickerItem
								key={o.id}
								option={o}
								color={categoryColorOf(colors, o.id)}
								selected={o.id === value}
								onPick={choose}
							/>
						))}
					</Command.Group>
				)}
			</Command.List>
		</Command>
	);

	if (isMobile) {
		return (
			<>
				{trigger}
				<Sheet open={open} onOpenChange={handleOpenChange}>
					<SheetContent
						side="bottom"
						showCloseButton={false}
						className="max-h-[85dvh] gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
					>
						<div className="flex items-center justify-between px-4 pt-4 pb-2">
							<SheetTitle>Category</SheetTitle>
							<SheetClose className="min-h-11 px-2 text-sm text-muted-foreground">
								Cancel
							</SheetClose>
						</div>
						<SheetDescription className="sr-only">
							Type to search, then tap a category.
						</SheetDescription>
						{list}
					</SheetContent>
				</Sheet>
			</>
		);
	}

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			{/* Mounted only while open, so it leaves at once: a list fading out over the field below
			    would take the next click (a Save button right after choosing). */}
			{open && (
				<PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0">
					{list}
				</PopoverContent>
			)}
		</Popover>
	);
}

function ColorDot({ color }: { color: string }) {
	return (
		<span
			aria-hidden
			className="size-2.5 shrink-0 rounded-full"
			style={{ backgroundColor: color }}
		/>
	);
}

function PickerItem({
	option,
	color,
	selected,
	onPick
}: {
	option: { id: string; label: string };
	color: string;
	selected: boolean;
	onPick: (id: string) => void;
}) {
	return (
		<Command.Item value={option.id} onSelect={() => onPick(option.id)} className={ITEM_CLASS}>
			<ColorDot color={color} />
			<span className="flex-1">{option.label}</span>
			{selected && <CheckIcon className="size-4" />}
		</Command.Item>
	);
}
