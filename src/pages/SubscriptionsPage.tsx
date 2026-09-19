import { useEffect, useState } from 'react';
import { Repeat, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { useSession } from '../context/SessionContext';
import { MerchantRepository } from '../data/dexie/merchantRepository';
import {
	detectSubscriptions,
	type DetectedSubscription,
	type SubscriptionCadence
} from '../domain/recurring/subscriptionDetectionEngine';
import { formatMinorUnits } from '../domain/shared/money';

const CADENCE_LABELS: Record<SubscriptionCadence, string> = {
	weekly: 'Weekly',
	monthly: 'Monthly',
	quarterly: 'Quarterly',
	yearly: 'Yearly'
};

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});
}

// User Story 1 (P1, spec 019): detected entirely from existing transaction history — no manual
// setup required. See contracts/subscription-detection.md.
export function SubscriptionsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [subscriptions, setSubscriptions] = useState<DetectedSubscription[]>([]);
	const [loading, setLoading] = useState(true);

	async function refresh() {
		setLoading(true);
		const results = await detectSubscriptions(key);
		setSubscriptions(results);
		setLoading(false);
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function dismiss(subscription: DetectedSubscription) {
		if (subscription.merchantId.startsWith('text:')) {
			// No resolved Merchant to attach the dismissal flag to — remove it from this view only.
			setSubscriptions((prev) => prev.filter((s) => s !== subscription));
			return;
		}
		try {
			await MerchantRepository.setSubscriptionDismissed(key, subscription.merchantId, true);
			await refresh();
			toast.success(`${subscription.merchantName} dismissed`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not dismiss subscription.');
		}
	}

	const totalMonthlyCost = subscriptions.reduce((sum, s) => sum + s.monthlyCostMinor, 0);

	return (
		<div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center gap-2">
				<Repeat className="size-6 text-primary" />
				<h1 className="text-2xl font-semibold tracking-tight">Subscriptions</h1>
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : subscriptions.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
						<Repeat className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">
							No repeating charges detected yet — subscriptions appear here automatically once a
							merchant is charged a similar amount at least twice.
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="flex flex-col gap-4">
					<Card>
						<CardContent className="flex items-center justify-between py-4">
							<span className="text-sm text-muted-foreground">Total detected monthly cost</span>
							<span className="font-mono text-lg font-semibold">
								{formatMinorUnits(totalMonthlyCost)}
							</span>
						</CardContent>
					</Card>

					{subscriptions.map((subscription) => (
						<Card key={subscription.merchantId}>
							<CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
								<div className="flex items-center gap-2">
									<CardTitle className="text-base">{subscription.merchantName}</CardTitle>
									{subscription.isLapsed && <Badge variant="destructive">Possibly lapsed</Badge>}
								</div>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => dismiss(subscription)}
									aria-label={`Dismiss ${subscription.merchantName}`}
								>
									<X className="size-4" />
								</Button>
							</CardHeader>
							<CardContent className="flex flex-col gap-1 text-sm">
								<div className="flex items-baseline justify-between">
									<span className="font-mono text-base font-semibold">
										{formatMinorUnits(subscription.monthlyCostMinor)} / mo
									</span>
									<Badge variant="secondary">{CADENCE_LABELS[subscription.cadence]}</Badge>
								</div>
								<p className="text-muted-foreground">
									{formatMinorUnits(subscription.averageAmountMinor)} per charge · last charged{' '}
									{formatDate(subscription.lastChargedDate)} · {subscription.chargeCount} charges
									seen
								</p>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
