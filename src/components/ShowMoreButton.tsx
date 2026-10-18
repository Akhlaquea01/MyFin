import { Button } from './ui/button';
import { cn } from '../lib/utils';

/** Reveals the next page of a long list; renders nothing once everything is shown. */
export function ShowMoreButton({
	hidden,
	step,
	onClick,
	className
}: {
	hidden: number;
	step: number;
	onClick: () => void;
	className?: string;
}) {
	if (hidden <= 0) return null;
	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			className={cn('self-center', className)}
			onClick={onClick}
		>
			Show {Math.min(step, hidden)} more ({hidden} not shown)
		</Button>
	);
}
