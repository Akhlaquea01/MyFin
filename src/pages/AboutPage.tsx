import { Info, Compass } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { useQuickTour } from '../hooks/useQuickTour';

const CAPABILITIES = [
	'Encrypted double-sided ledger with split transactions & soft-delete recovery',
	'Debt payoff planner (snowball / avalanche / custom)',
	'Savings goals with pace projection',
	'Recurring bills & budget threshold notifications',
	'Encrypted receipt attachments',
	'Auto-categorization & merchant learning',
	'Financial health score & insights',
	'PWA share target for receipts and bank SMS',
	'Multi-account CSV/Excel import',
	'Lending & borrowing (person loans) ledger',
	'Year in review report & PDF export',
	'Tag taxonomy & saved filter views',
	'Interactive quick tour & onboarding',
	'Starter setup template export & import'
];

// About page: version, creator, description, and a shortcut back into the quick tour — none
// of this existed before (no route surfaced package.json's version anywhere in the UI).
export function AboutPage() {
	const { startTour } = useQuickTour();

	return (
		<div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center gap-2">
				<Info className="size-6 text-primary" />
				<h1 className="text-2xl font-semibold tracking-tight">About</h1>
			</div>

			<Card className="mb-6">
				<CardHeader>
					<CardTitle className="text-base">MyFin</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-2 text-sm">
					<p className="text-muted-foreground">
						A private, offline-first personal finance manager. Your data never leaves your device.
					</p>
					<dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
						<dt className="text-muted-foreground">Version</dt>
						<dd className="font-mono">{__APP_VERSION__}</dd>
						<dt className="text-muted-foreground">Created by</dt>
						<dd>akhalque</dd>
					</dl>
				</CardContent>
			</Card>

			<Card className="mb-6">
				<CardHeader>
					<CardTitle className="text-base">What's inside</CardTitle>
				</CardHeader>
				<CardContent>
					<ul className="grid list-disc gap-1.5 pl-4 text-sm text-muted-foreground sm:grid-cols-2">
						{CAPABILITIES.map((c) => (
							<li key={c}>{c}</li>
						))}
					</ul>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">Need a refresher?</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<p className="text-sm text-muted-foreground">
						Replay the introductory quick tour to see the main areas of the app again.
					</p>
					<Button type="button" variant="outline" onClick={startTour} className="w-fit">
						<Compass className="mr-2 h-4 w-4" /> Replay quick tour
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
