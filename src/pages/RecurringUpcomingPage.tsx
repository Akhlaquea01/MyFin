import { useEffect, useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { useSession } from '../context/SessionContext';
import { AccountRepository } from '../data/dexie/accountRepository';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import { RecurringRepository, ExpectedEventRepository } from '../data/dexie/recurringRepository';
import { generateExpectedEvents, markMissedPastDue } from '../domain/recurring/recurringEngine';
import type {
	Account,
	Category,
	ExpectedEvent,
	ExpectedEventStatus,
	RecurringRule
} from '../domain/entities';
import { buildCategoryLabels } from '../domain/categories/categoryHierarchy';
import { addDaysISO, todayLocalISO } from '../domain/shared/dateMath';
import { formatMoney } from '../domain/shared/money';

const STATUS_VARIANT: Record<ExpectedEventStatus, 'outline' | 'secondary' | 'destructive'> = {
	pending: 'outline',
	matched: 'secondary',
	missed: 'destructive'
};

const LOOKAHEAD_DAYS = 60;
/** How far back settled (paid or missed) payments are still listed; older ones sit behind a toggle. */
const RECENT_HISTORY_DAYS = 30;

// User Story 6 (P6): upcoming expected events, generated ahead of time (FR-029) with
// missed occurrences flagged (FR-031).
//
// "Upcoming" lists what is due, soonest first, with the payments of the last month for context. Every
// event ever generated used to be listed oldest-first, so after a few months the page opened on
// last year's paid bills and what was actually due sat at the bottom; each row showed only a category
// name, so two rules in one category could not be told apart and no amount appeared.
export function RecurringUpcomingPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [categories, setCategories] = useState<Category[]>([]);
	const [accounts, setAccounts] = useState<Account[]>([]);
	const [events, setEvents] = useState<ExpectedEvent[]>([]);
	const [rulesById, setRulesById] = useState<Record<string, RecurringRule>>({});
	const [showEarlier, setShowEarlier] = useState(false);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void (async () => {
			const [cats, accts, activeRules] = await Promise.all([
				CategoryRepository.list(key),
				AccountRepository.list(key),
				RecurringRepository.listActive(key)
			]);
			setCategories(cats);
			setAccounts(accts);
			setRulesById(Object.fromEntries(activeRules.map((r) => [r.id, r])));

			const throughDate = new Date();
			throughDate.setDate(throughDate.getDate() + LOOKAHEAD_DAYS);
			for (const rule of activeRules) {
				await generateExpectedEvents(key, rule, throughDate);
			}
			await markMissedPastDue(key);

			// Reminders of a paused (or removed) rule are not upcoming anything.
			const activeRuleIds = new Set(activeRules.map((r) => r.id));
			setEvents(
				(await ExpectedEventRepository.listAll(key)).filter((e) =>
					activeRuleIds.has(e.recurringRuleId)
				)
			);
			setLoading(false);
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const categoryLabels = useMemo(() => buildCategoryLabels(categories), [categories]);
	const accountNames = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);

	// Soonest first. `listAll` already sorts by date, ascending.
	const recentFrom = addDaysISO(todayLocalISO(), -RECENT_HISTORY_DAYS);
	const earlier = events.filter((e) => e.expectedDate < recentFrom);
	const visible = showEarlier ? events : events.filter((e) => e.expectedDate >= recentFrom);

	function titleFor(event: ExpectedEvent): { title: string; detail: string[] } {
		const rule = rulesById[event.recurringRuleId];
		const category = (rule && categoryLabels.get(rule.categoryId)) || 'Recurring';
		const detail: string[] = [event.expectedDate];
		if (rule) {
			const account = accountNames.get(rule.accountId);
			if (account) detail.push(account);
			// A rule's own name leads; its category then goes in the detail so it is not lost.
			if (rule.label && rule.label.trim() !== category) detail.push(category);
			return { title: rule.label?.trim() || category, detail };
		}
		return { title: category, detail };
	}

	return (
		<div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
			<h1 className="mb-6 text-2xl font-semibold tracking-tight">Upcoming</h1>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : events.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
						<CalendarClock className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">Nothing expected right now.</p>
					</CardContent>
				</Card>
			) : (
				<div className="flex flex-col gap-2">
					{earlier.length > 0 && (
						<Button
							variant="ghost"
							size="sm"
							className="self-start"
							onClick={() => setShowEarlier((shown) => !shown)}
						>
							{showEarlier
								? 'Hide earlier payments'
								: `Show ${earlier.length} earlier ${earlier.length === 1 ? 'payment' : 'payments'}`}
						</Button>
					)}
					{visible.map((event) => {
						const { title, detail } = titleFor(event);
						const rule = rulesById[event.recurringRuleId];
						return (
							<div
								key={event.id}
								className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
							>
								<div className="min-w-0">
									<p className="truncate text-sm font-medium">{title}</p>
									<p className="truncate text-xs text-muted-foreground">{detail.join(' · ')}</p>
								</div>
								<div className="flex shrink-0 items-center gap-3">
									{rule && (
										<span className="text-sm tabular-nums">
											{formatMoney(Math.abs(rule.amount))}
										</span>
									)}
									<Badge variant={STATUS_VARIANT[event.status]}>{event.status}</Badge>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
