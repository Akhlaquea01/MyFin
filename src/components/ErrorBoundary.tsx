import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui/button';

/**
 * Catches render-time throws anywhere below it so a single failure degrades to a readable,
 * recoverable screen instead of unmounting the whole tree to a blank page.
 *
 * This matters more here than in a typical app: every page calls `useSession().getEncryptionKey()`
 * during render, and that function throws by design whenever the session key is absent or
 * unusable (locked mid-render, or a key that no longer matches the data — e.g. a backup
 * restored under a different PIN). Without a boundary those are unrecoverable white screens
 * with no route back to the LockScreen that would fix them.
 *
 * `onReset` is expected to lock the session, which returns the Gate to LockScreen — the one
 * action that resolves every key-related failure this can catch.
 */
interface Props {
	children: ReactNode;
	onReset: () => void;
}

interface State {
	error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		// Constitution Principle II forbids financial data in console output. An Error's
		// message/stack is app-authored control flow, never an entity, so this is safe — and
		// without it a production failure leaves nothing at all to diagnose from.
		console.error('[ErrorBoundary]', error.message, info.componentStack);
	}

	private handleReset = () => {
		this.setState({ error: null });
		this.props.onReset();
	};

	render() {
		const { error } = this.state;
		if (!error) return this.props.children;

		return (
			<div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
				<div className="flex size-14 items-center justify-center rounded-full bg-destructive/10">
					<AlertTriangle className="size-7 text-destructive" />
				</div>
				<h1 className="text-xl font-semibold">Something went wrong</h1>
				<p className="max-w-sm text-sm text-muted-foreground">
					Your data is still on this device and has not been changed. Unlocking again resolves most
					problems — you'll be asked for your PIN.
				</p>
				<p className="max-w-sm font-mono text-xs break-words text-muted-foreground">
					{error.message}
				</p>
				<Button onClick={this.handleReset}>Back to lock screen</Button>
			</div>
		);
	}
}
