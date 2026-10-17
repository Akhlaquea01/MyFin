import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from 'cn';
import { hubForPath } from '../lib/hubs';
import { isNativeApp } from '../lib/native/platform';
import { MOBILE_QUERY, useMediaQuery } from '../hooks/useMediaQuery';

/**
 * A strip of the open screen's sibling screens along the top of a phone page, so related screens
 * (Budgets, Budget vs. Actual, Goals…) are one tap apart instead of a trip through the menu. Drawn
 * on a phone for every hub; from md up only for a folded hub (Data, Automation, Settings), whose
 * screens the sidebar lists as a single entry, while it already shows every other screen itself.
 */
export function HubTabs() {
	const { pathname } = useLocation();
	const isMobile = useMediaQuery(MOBILE_QUERY);
	const activeRef = useRef<HTMLAnchorElement>(null);
	const match = hubForPath(pathname, isNativeApp());

	useEffect(() => {
		activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
	}, [pathname]);

	if (!match || match.items.length < 2 || (!isMobile && !match.hub.folded)) return null;
	return (
		<nav
			aria-label={`${match.hub.label} screens`}
			className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur"
		>
			<ul className="flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 py-2 md:px-6 [&::-webkit-scrollbar]:hidden">
				{match.items.map((item) => {
					const isActive = item.to === match.active.to;
					return (
						<li key={item.to} className="shrink-0">
							<Link
								ref={isActive ? activeRef : undefined}
								to={item.to}
								aria-current={isActive ? 'page' : undefined}
								className={cn(
									'inline-flex min-h-9 items-center rounded-full px-3.5 text-sm whitespace-nowrap transition-colors',
									isActive
										? 'bg-primary/15 font-medium text-primary ring-1 ring-primary/40'
										: 'bg-muted/60 text-muted-foreground hover:bg-muted'
								)}
							>
								{item.label}
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
