import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui/button';
import { SessionLockedError } from '../context/SessionContext';

/**
 * Catches a render-time throw from the *current page only*, leaving AppShell's nav/header
 * intact — unlike the single app-level ErrorBoundary this sits inside, an unrelated bug on one
 * page (e.g. a chart fed a malformed data shape) no longer takes down navigation and every
 * other page, forcing a full unlock to recover.
 *
 * A `SessionLockedError` is deliberately NOT handled here: it means the whole session's key is
 * unusable, not just this page, so `getDerivedStateFromError` re-throws it to let it keep
 * propagating to the app-level ErrorBoundary, which is the only thing that can actually fix it
 * (by returning to LockScreen).
 */
interface Props {
	children: ReactNode;
}

interface State {
	error: Error | null;
}

export class PageErrorBoundary extends Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		if (error instanceof SessionLockedError) throw error;
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error('[PageErrorBoundary]', error.message, info.componentStack);
	}

	private handleReset = () => {
		this.setState({ error: null });
	};

	render() {
		const { error } = this.state;
		if (!error) return this.props.children;

		return (
			<div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
				<div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
					<AlertTriangle className="size-6 text-destructive" />
				</div>
				<h2 className="text-lg font-semibold">This page couldn't load</h2>
				<p className="text-sm text-muted-foreground">
					Your data is still on this device and has not been changed. Use the navigation to try
					another page, or try this one again.
				</p>
				<p className="max-w-sm font-mono text-xs break-words text-muted-foreground">
					{error.message}
				</p>
				<Button onClick={this.handleReset}>Try again</Button>
			</div>
		);
	}
}
