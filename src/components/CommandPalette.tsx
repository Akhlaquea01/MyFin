import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { VisuallyHidden, Dialog as DialogPrimitive } from 'radix-ui';
import { CreditCard, Receipt, Users } from 'lucide-react';
import { querySearchIndex, type SearchIndexEntry } from '../domain/search/searchIndex';

const GROUP_LABELS: Record<SearchIndexEntry['type'], string> = {
	transaction: 'Transactions',
	payee: 'Payees',
	account: 'Accounts'
};

const GROUP_ICONS: Record<SearchIndexEntry['type'], typeof Receipt> = {
	transaction: Receipt,
	payee: Users,
	account: CreditCard
};

/**
 * Global Ctrl+K/Cmd+K quick search over transactions, payees, and accounts (User Story 5,
 * spec 019, FR-018–FR-020). Queries an in-memory index built once per unlock — never Dexie
 * directly (contracts/command-palette-search.md) — and is only ever mounted inside the
 * authenticated app shell, so it structurally cannot open while the app is locked (FR-021).
 */
export function CommandPalette({
	open,
	onOpenChange,
	index
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	index: SearchIndexEntry[];
}) {
	const navigate = useNavigate();
	const [query, setQuery] = useState('');

	const results = useMemo(() => querySearchIndex(index, query), [index, query]);
	const grouped = useMemo(() => {
		const groups = new Map<SearchIndexEntry['type'], SearchIndexEntry[]>();
		for (const entry of results) {
			const list = groups.get(entry.type) ?? [];
			list.push(entry);
			groups.set(entry.type, list);
		}
		return groups;
	}, [results]);

	function select(entry: SearchIndexEntry) {
		navigate(entry.route);
		onOpenChange(false);
		setQuery('');
	}

	function handleOpenChange(next: boolean) {
		onOpenChange(next);
		if (!next) setQuery('');
	}

	return (
		<Command.Dialog
			open={open}
			onOpenChange={handleOpenChange}
			label="Search transactions, payees, and accounts"
			overlayClassName="fixed inset-0 isolate z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
			contentClassName="fixed top-24 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10"
			shouldFilter={false}
		>
			<VisuallyHidden.Root>
				<DialogPrimitive.Title>Quick search</DialogPrimitive.Title>
				<DialogPrimitive.Description>
					Search transactions, payees, and accounts
				</DialogPrimitive.Description>
			</VisuallyHidden.Root>
			<Command.Input
				value={query}
				onValueChange={setQuery}
				placeholder="Search transactions, payees, accounts…"
				className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
			/>
			<Command.List className="max-h-80 overflow-y-auto p-2">
				<Command.Empty className="py-6 text-center text-sm text-muted-foreground">
					{query ? 'No matches.' : 'Type to search…'}
				</Command.Empty>
				{(['transaction', 'payee', 'account'] as const).map((type) => {
					const entries = grouped.get(type);
					if (!entries || entries.length === 0) return null;
					const Icon = GROUP_ICONS[type];
					return (
						<Command.Group
							key={type}
							heading={GROUP_LABELS[type]}
							className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
						>
							{entries.map((entry) => (
								<Command.Item
									key={`${entry.type}-${entry.id}`}
									value={`${entry.type}-${entry.id}-${entry.label}`}
									onSelect={() => select(entry)}
									className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm data-selected:bg-muted"
								>
									<Icon className="size-4 shrink-0 text-muted-foreground" />
									<span className="flex-1 truncate">{entry.label}</span>
									{entry.secondaryLabel && (
										<span className="shrink-0 text-xs text-muted-foreground">
											{entry.secondaryLabel}
										</span>
									)}
								</Command.Item>
							))}
						</Command.Group>
					);
				})}
			</Command.List>
		</Command.Dialog>
	);
}
