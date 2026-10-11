import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useSession } from '../context/SessionContext';
import { AccountRepository } from '../data/dexie/accountRepository';
import {
	InvestmentHoldingRepository,
	InvestmentValuationRepository
} from '../data/dexie/wealthRepository';
import { editHolding, undoLatestTrade } from '../domain/wealth/wealthEngine';
import { INVESTMENT_TYPE_LABELS } from '../domain/wealth/investmentTypeLabels';
import { formatMinorUnits, isNonNegativeMoney, parseMoneyOrZero } from '../domain/shared/money';
import type {
	Account,
	InvestmentHolding,
	InvestmentTrade,
	InvestmentType,
	InvestmentValuation
} from '../domain/entities';

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

/**
 * Correct a holding after it was added: its name, type, and the units / price it was entered with —
 * and remove a value that was recorded wrongly. Until now a typo in any of these meant deleting
 * nothing (there was no delete either) and living with it.
 *
 * This overwrites; to record a purchase or a sale use "Buy more units" / "Sell units", which keep the
 * average price and cost basis coherent.
 */
export function HoldingEditDialog({
	holding,
	onOpenChange,
	onChanged
}: {
	holding: InvestmentHolding;
	onOpenChange: (open: boolean) => void;
	/** Something was saved or removed — the page reloads its holdings and values. */
	onChanged: () => void;
}) {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const tracksUnits = holding.units !== undefined && holding.avgPrice !== undefined;
	const [name, setName] = useState(holding.name);
	const [type, setType] = useState<InvestmentType>(holding.type);
	const [units, setUnits] = useState(tracksUnits ? String(holding.units) : '');
	const [avgPrice, setAvgPrice] = useState(tracksUnits ? formatMinorUnits(holding.avgPrice!) : '');
	const [costBasis, setCostBasis] = useState(formatMinorUnits(holding.costBasis));
	const [saving, setSaving] = useState(false);
	const [history, setHistory] = useState<InvestmentValuation[]>([]);
	const [trades, setTrades] = useState<InvestmentTrade[]>([]);
	const [accounts, setAccounts] = useState<Account[]>([]);

	async function loadHistory() {
		try {
			setHistory(await InvestmentValuationRepository.listForHolding(key, holding.id));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not load the value history.');
		}
	}

	// The holding handed to this dialog is a snapshot from when it opened; the trades are read fresh.
	async function loadTrades() {
		try {
			const [fresh, allAccounts] = await Promise.all([
				InvestmentHoldingRepository.getById(key, holding.id),
				AccountRepository.list(key, true)
			]);
			setTrades(fresh?.trades ?? []);
			setAccounts(allAccounts);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not load the trades.');
		}
	}

	useEffect(() => {
		void loadHistory();
		void loadTrades();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function accountName(id: string | null): string {
		return id ? (accounts.find((a) => a.id === id)?.name ?? 'an account') : 'no account';
	}

	async function undoTrade(trade: InvestmentTrade) {
		const verb = trade.kind === 'buy' ? 'purchase' : 'sale';
		const money =
			trade.transactionId && trade.amount !== null
				? ` and ${formatMoney(trade.amount)} ${trade.kind === 'buy' ? 'goes back into' : 'is taken back out of'} ${accountName(trade.accountId)}`
				: '';
		if (
			!window.confirm(
				`Undo the ${verb} of ${trade.units.toLocaleString(undefined, { maximumFractionDigits: 4 })} units on ${trade.date}? The holding goes back to ${(trade.before.units ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} units${money}.`
			)
		) {
			return;
		}
		try {
			await undoLatestTrade(key, holding.id, trade.id);
			toast.success(`${verb[0].toUpperCase()}${verb.slice(1)} undone`);
			onChanged();
			// The units and price above are now out of date; reopening shows the restored figures.
			onOpenChange(false);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not undo that.');
		}
	}

	async function removeValuation(valuation: InvestmentValuation) {
		if (
			!window.confirm(
				`Delete the ${formatMoney(valuation.value)} value recorded on ${valuation.date}? The holding goes back to its previous value.`
			)
		) {
			return;
		}
		try {
			await InvestmentValuationRepository.delete(valuation.id);
			await loadHistory();
			onChanged();
			toast.success('Value deleted');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not delete that value.');
		}
	}

	async function save() {
		if (!name.trim()) return toast.error('Name is required.');
		setSaving(true);
		try {
			if (tracksUnits) {
				const unitCount = Number(units);
				if (!units.trim() || !Number.isFinite(unitCount) || unitCount < 0) {
					return toast.error('Enter the number of units held (0 or more).');
				}
				if (!isNonNegativeMoney(avgPrice || '0')) {
					return toast.error('Enter a valid average price per unit.');
				}
				await editHolding(key, holding.id, {
					name,
					type,
					units: unitCount,
					avgPrice: parseMoneyOrZero(avgPrice || '0')
				});
			} else {
				if (!isNonNegativeMoney(costBasis || '0')) return toast.error('Enter a valid cost basis.');
				await editHolding(key, holding.id, {
					name,
					type,
					costBasis: parseMoneyOrZero(costBasis || '0')
				});
			}
			toast.success(`${name.trim()} updated`);
			onOpenChange(false);
			onChanged();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not save changes.');
		} finally {
			setSaving(false);
		}
	}

	// Shown as the user types, so the consequence of a units/price edit is visible before saving.
	const derivedCostBasis = tracksUnits
		? Math.round(
				(Number(units) || 0) *
					parseMoneyOrZero(isNonNegativeMoney(avgPrice || '0') ? avgPrice || '0' : '0')
			)
		: null;

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Edit {holding.name}</DialogTitle>
					<DialogDescription>
						This corrects the details as entered. To record buying or selling, use{' '}
						<strong>Buy more units</strong> or <strong>Sell units</strong> instead.
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						void save();
					}}
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="holding-edit-name">Name</Label>
						<Input id="holding-edit-name" value={name} onChange={(e) => setName(e.target.value)} />
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="holding-edit-type">Type</Label>
						<Select value={type} onValueChange={(value) => setType(value as InvestmentType)}>
							<SelectTrigger id="holding-edit-type" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{Object.entries(INVESTMENT_TYPE_LABELS).map(([value, label]) => (
									<SelectItem key={value} value={value}>
										{label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					{tracksUnits ? (
						<>
							<div className="grid grid-cols-2 gap-3">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="holding-edit-units">Units</Label>
									<Input
										id="holding-edit-units"
										type="number"
										step="any"
										value={units}
										onChange={(e) => setUnits(e.target.value)}
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="holding-edit-avg-price">Avg. price / unit</Label>
									<Input
										id="holding-edit-avg-price"
										type="number"
										step="0.01"
										value={avgPrice}
										onChange={(e) => setAvgPrice(e.target.value)}
									/>
								</div>
							</div>
							<p className="text-xs text-muted-foreground">
								Cost basis: {formatMoney(derivedCostBasis ?? 0)} (units × average price)
							</p>
							{trades.length > 0 && (
								<p className="text-xs text-muted-foreground">
									Changing the units or price clears the list of trades below, so they can no longer
									be undone.
								</p>
							)}
						</>
					) : (
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="holding-edit-cost-basis">Cost basis</Label>
							<Input
								id="holding-edit-cost-basis"
								type="number"
								step="0.01"
								value={costBasis}
								onChange={(e) => setCostBasis(e.target.value)}
							/>
							<p className="text-xs text-muted-foreground">
								This holding has no unit data, so its cost basis is entered directly.
							</p>
						</div>
					)}

					{trades.length > 0 && (
						<div className="flex flex-col gap-1.5">
							<p className="text-sm font-medium">Purchases and sales</p>
							<ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
								{[...trades].reverse().map((trade, index) => (
									<li
										key={trade.id}
										className="flex items-center justify-between gap-2 rounded-md border px-2 py-1"
									>
										<span className="flex flex-col">
											<span>
												{trade.kind === 'buy' ? 'Bought' : 'Sold'}{' '}
												{trade.units.toLocaleString(undefined, { maximumFractionDigits: 4 })} units
												{trade.price !== null && <> @ {formatMoney(trade.price)}</>}
											</span>
											<span className="text-xs text-muted-foreground">
												{trade.date} ·{' '}
												{trade.transactionId
													? `${trade.kind === 'buy' ? 'paid from' : 'proceeds to'} ${accountName(trade.accountId)}`
													: 'holding only'}
											</span>
										</span>
										{index === 0 && (
											<Button
												type="button"
												size="sm"
												variant="outline"
												aria-label="Undo latest trade"
												onClick={() => void undoTrade(trade)}
											>
												Undo
											</Button>
										)}
									</li>
								))}
							</ul>
							<p className="text-xs text-muted-foreground">
								Only the latest can be undone, which also puts back the money in the account it was
								recorded in.
							</p>
						</div>
					)}

					<div className="flex flex-col gap-1.5">
						<p className="text-sm font-medium">Recorded values</p>
						{history.length === 0 ? (
							<p className="text-xs text-muted-foreground">
								None yet — the holding is valued at its cost basis until you use{' '}
								<strong>Update value</strong>.
							</p>
						) : (
							<ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
								{history.map((valuation, index) => (
									<li
										key={valuation.id}
										className="flex items-center justify-between gap-2 rounded-md border px-2 py-1"
									>
										<span className="text-muted-foreground">
											{valuation.date}
											{index === 0 && <span className="ml-1 text-xs italic">(current)</span>}
										</span>
										<span className="flex items-center gap-1">
											<span className="font-mono">{formatMoney(valuation.value)}</span>
											<Button
												type="button"
												size="icon-sm"
												variant="ghost"
												aria-label={`Delete value from ${valuation.date}`}
												onClick={() => void removeValuation(valuation)}
											>
												<Trash2 className="text-destructive" />
											</Button>
										</span>
									</li>
								))}
							</ul>
						)}
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={saving}>
							{saving ? 'Saving…' : 'Save changes'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
