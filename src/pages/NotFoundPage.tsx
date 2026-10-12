import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '../components/ui/button';

// Reached by an unknown or stale address (an old bookmark, a share link opened as a page). Inside
// the app shell so the navigation is still there.
export function NotFoundPage() {
	return (
		<div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
			<div className="flex size-12 items-center justify-center rounded-full bg-muted">
				<Compass className="size-6 text-muted-foreground" />
			</div>
			<h1 className="text-xl font-semibold">Page not found</h1>
			<p className="text-sm text-muted-foreground">
				There is nothing at this address. Use the menu to find what you were looking for, or go back
				to the Dashboard.
			</p>
			<Button asChild>
				<Link to="/">Go to Dashboard</Link>
			</Button>
		</div>
	);
}
