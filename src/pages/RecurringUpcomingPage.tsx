import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { useSession } from '../context/SessionContext';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import { RecurringRepository, ExpectedEventRepository } from '../data/dexie/recurringRepository';
import { generateExpectedEvents, markMissedPastDue } from '../domain/recurring/recurringEngine';
import type { Category, ExpectedEvent, ExpectedEventStatus } from '../domain/entities';

const STATUS_VARIANT: Record<ExpectedEventStatus, 'outline' | 'secondary' | 'destructive'> = {
	pending: 'outline',
	matched: 'secondary',
	missed: 'destructive'
};

const LOOKAHEAD_DAYS = 60;

// User Story 6 (P6): upcoming expected events, generated ahead of time (FR-029) with
// missed occurrences flagged (FR-031).
export function RecurringUpcomingPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [categories, setCategories] = useState<Category[]>([]);
	const [events, setEvents] = useState<ExpectedEvent[]>([]);
	const [ruleCategoryByRuleId, setRuleCategoryByRuleId] = useState<Record<string, string>>({});
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void (async () => {
			const [cats, activeRules] = await Promise.all([
				CategoryRepository.list(key),
				RecurringRepository.listActive(key)
			]);
			setCategories(cats);
			setRuleCategoryByRuleId(Object.fromEntries(activeRules.map((r) => [r.id, r.categoryId])));

			const throughDate = new Date();
			throughDate.setDate(throughDate.getDate() + LOOKAHEAD_DAYS);
			for (const rule of activeRules) {
				await generateExpectedEvents(key, rule, throughDate);
			}
			await markMissedPastDue(key);

			setEvents(await ExpectedEventRepository.listAll(key));
			setLoading(false);
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function categoryNameForEvent(event: ExpectedEvent): string {
		const categoryId = ruleCategoryByRuleId[event.recurringRuleId];
		return categories.find((c) => c.id === categoryId)?.name ?? 'Recurring';
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
					{events.map((event) => (
						<div
							key={event.id}
							className="flex items-center justify-between rounded-lg border px-4 py-3"
						>
							<div>
								<p className="text-sm font-medium">{categoryNameForEvent(event)}</p>
								<p className="text-xs text-muted-foreground">{event.expectedDate}</p>
							</div>
							<Badge variant={STATUS_VARIANT[event.status]}>{event.status}</Badge>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
