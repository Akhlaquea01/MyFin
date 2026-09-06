import { Layers } from 'lucide-react';

// FR-045: shown in every tab/window beyond the first, since concurrent writes from two
// tabs could corrupt balances. Automatically resolves once the other tab closes
// (src/lib/singleInstance.ts polls and promotes this tab to primary).
export function BlockedScreen() {
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
			<div className="flex size-14 items-center justify-center rounded-full bg-muted">
				<Layers className="size-7 text-muted-foreground" />
			</div>
			<h1 className="text-xl font-semibold">Already open in another tab</h1>
			<p className="max-w-sm text-sm text-muted-foreground">
				Personal Finance Manager can only be open in one tab at a time, to keep your balances safe.
				Close this tab, or close the other one to continue here.
			</p>
		</div>
	);
}
