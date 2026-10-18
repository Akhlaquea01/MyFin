import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BellRing, CalendarClock, HandCoins, PiggyBank, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { ShowMoreButton } from '../components/ShowMoreButton';
import { useSession } from '../context/SessionContext';
import { useShowMore } from '../hooks/useShowMore';
import { NotificationInboxRepository } from '../data/dexie/notificationInboxRepository';
import { ALERTS_CHANGED_EVENT, announceAlertsChanged } from '../lib/alertsEvent';
import { useConfirm } from '../lib/confirm';
import type { InboxNotification, InboxNotificationKind } from '../domain/entities';

// The inbox keeps up to INBOX_LIMIT entries; a hundred cards at once is a very long page.
const ALERTS_PAGE_SIZE = 20;

const KIND_ICON: Record<InboxNotificationKind, typeof BellRing> = {
	recurring: CalendarClock,
	budget: PiggyBank,
	personLoan: HandCoins
};

function formatWhen(epochMs: number): string {
	return new Date(epochMs).toLocaleString(undefined, {
		day: 'numeric',
		month: 'short',
		hour: 'numeric',
		minute: '2-digit'
	});
}

// The in-app record of reminders: due bills, budgets near their limit, overdue loans. A system
// notification is gone once dismissed, and never appears at all while notifications are blocked or
// the app is closed; whatever the unlock-time check found is kept here until the user clears it.
export function AlertsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const navigate = useNavigate();
	const confirm = useConfirm();

	const [items, setItems] = useState<InboxNotification[] | null>(null);
	const paging = useShowMore(items?.length ?? 0, ALERTS_PAGE_SIZE);

	const load = useCallback(async () => {
		try {
			setItems(await NotificationInboxRepository.list(key));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not load your alerts.');
			setItems([]);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		void load();
		// A check finishing after this page opened (the unlock work runs beside it) adds entries.
		const onChanged = () => void load();
		window.addEventListener(ALERTS_CHANGED_EVENT, onChanged);
		return () => window.removeEventListener(ALERTS_CHANGED_EVENT, onChanged);
	}, [load]);

	const unread = (items ?? []).filter((i) => i.readAt === null).length;

	async function open(item: InboxNotification) {
		try {
			await NotificationInboxRepository.markRead(key, item.id);
			announceAlertsChanged();
		} catch {
			// Opening the screen matters more than the read mark.
		}
		navigate(item.route);
	}

	async function dismiss(item: InboxNotification) {
		await NotificationInboxRepository.remove(item.id);
		announceAlertsChanged();
		await load();
	}

	async function markAllRead() {
		await NotificationInboxRepository.markAllRead(key);
		announceAlertsChanged();
		await load();
	}

	async function clearAll() {
		const ok = await confirm({
			message: 'Clear every alert? Your bills, budgets and loans are not affected.',
			confirmLabel: 'Clear all',
			destructive: true
		});
		if (!ok) return;
		await NotificationInboxRepository.clear();
		announceAlertsChanged();
		await load();
	}

	return (
		<div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
					<BellRing className="size-6 text-primary" /> Alerts
				</h1>
				{items && items.length > 0 && (
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={unread === 0}
							onClick={() => void markAllRead()}
						>
							Mark all as read
						</Button>
						<Button variant="ghost" size="sm" onClick={() => void clearAll()}>
							Clear all
						</Button>
					</div>
				)}
			</div>

			<p className="-mt-3 mb-5 text-sm text-muted-foreground">
				Reminders for bills, budgets and loans. New bank messages to check wait in{' '}
				<Link to="/review" className="text-primary underline underline-offset-2">
					Review
				</Link>
				.
			</p>

			{items === null ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : items.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
						<BellRing className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">No alerts.</p>
						<p className="max-w-sm text-xs text-muted-foreground">
							When MyFin finds a bill coming due, a budget near its limit or an overdue loan —
							checked each time you unlock it — it is listed here, even if system notifications are
							off.{' '}
							<Link to="/notification-settings" className="underline underline-offset-2">
								Notification settings
							</Link>
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="flex flex-col gap-3">
					<ul className="flex flex-col gap-2">
						{items.slice(0, paging.visible).map((item) => {
							const Icon = KIND_ICON[item.kind] ?? BellRing;
							const isUnread = item.readAt === null;
							return (
								<li key={item.id}>
									<Card className={isUnread ? 'border-primary/40' : undefined}>
										<CardContent className="flex items-start gap-3 py-3">
											<Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
											<button
												type="button"
												className="min-w-0 flex-1 text-left"
												onClick={() => void open(item)}
											>
												<span className="flex flex-wrap items-center gap-2 text-sm font-medium">
													{item.title}
													{isUnread && <Badge variant="secondary">New</Badge>}
												</span>
												<span className="block text-sm text-muted-foreground">{item.body}</span>
												<span className="block text-xs text-muted-foreground">
													{formatWhen(item.createdAt)}
												</span>
											</button>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Dismiss ${item.title}`}
												onClick={() => void dismiss(item)}
											>
												<X />
											</Button>
										</CardContent>
									</Card>
								</li>
							);
						})}
					</ul>
					<ShowMoreButton
						hidden={paging.hidden}
						step={ALERTS_PAGE_SIZE}
						onClick={paging.showMore}
					/>
				</div>
			)}
		</div>
	);
}
