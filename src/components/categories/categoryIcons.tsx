import { Tag } from 'lucide-react';
import { cn } from 'cn';
import { ICON_BY_KEY } from './categoryIconSet';

/**
 * A category's mark: its icon (or a tag when it has none) on a tile tinted with its colour. The tint
 * is the colour mixed into the card background, so it reads the same in light and dark mode. Purely
 * decorative — the name is always written beside it.
 */
export function CategoryGlyph({
	icon,
	color,
	size = 'md',
	className
}: {
	icon: string | null | undefined;
	/** Any CSS colour, normally `var(--cat-n)`. */
	color: string;
	size?: 'sm' | 'md';
	className?: string;
}) {
	const Icon = (icon && ICON_BY_KEY.get(icon)) || Tag;
	return (
		<span
			aria-hidden
			className={cn(
				'flex shrink-0 items-center justify-center rounded-lg',
				size === 'md' ? 'size-10' : 'size-7 rounded-md',
				className
			)}
			style={{
				backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`,
				color
			}}
		>
			<Icon className={size === 'md' ? 'size-5' : 'size-4'} />
		</span>
	);
}
