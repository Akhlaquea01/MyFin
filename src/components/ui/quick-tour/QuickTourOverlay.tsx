import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useQuickTour } from '../../../hooks/useQuickTour';
import { QUICK_TOUR_STEPS } from './tour-steps';
import { Button } from '../button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../card';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { createPortal } from 'react-dom';

const DEFAULT_CARD_HEIGHT = 200;
const TITLE_ID = 'quick-tour-title';
const DESCRIPTION_ID = 'quick-tour-description';
const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * True only for an element that's actually rendered and occupies space. A `display:none`
 * ancestor (e.g. the desktop nav's copy of a `data-tour` target while the tour meant to
 * highlight the mobile sheet's closed-and-unmounted copy) still matches `querySelector`, but
 * its `getBoundingClientRect()` is an all-zero rect that is nonetheless truthy — treating that
 * as "found" pinned a phantom 0x0 highlight box top-left instead of falling back to the
 * centered card.
 */
export function isElementVisible(el: Element): boolean {
	if (el.getClientRects().length === 0) return false;
	const rect = el.getBoundingClientRect();
	return rect.width > 0 || rect.height > 0;
}

/**
 * A `data-tour` selector can match more than one element at once: the desktop sidebar and the
 * mobile nav sheet both render the same `NavLinks`, so both copies carry the same attribute.
 * `querySelector` alone always returns the FIRST match in DOM order — the desktop copy, since
 * it comes first in AppShell's markup — regardless of which one is actually on screen. On a
 * narrow viewport that copy is `display:none`, so every nav-targeted step fell back to the
 * centered "target not found" card even when the mobile sheet was open and its own copy was
 * visible. This checks every match and returns whichever one actually is.
 */
export function findVisibleTarget(selector: string): Element | null {
	const candidates = document.querySelectorAll(selector);
	for (const el of candidates) {
		if (isElementVisible(el)) return el;
	}
	return null;
}

export function QuickTourOverlay() {
	const { isTourActive, currentStep, nextStep, prevStep, skipTour, totalSteps } = useQuickTour();
	const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
	const [cardHeight, setCardHeight] = useState(DEFAULT_CARD_HEIGHT);
	const cardRef = useRef<HTMLDivElement>(null);
	const portalRootRef = useRef<HTMLDivElement>(null);
	const rafRef = useRef<number | null>(null);
	const step = QUICK_TOUR_STEPS[currentStep];

	// Measure-only: never scrolls, so it's safe to call from the scroll listener without
	// re-triggering the very scroll it's reacting to (see the effect below).
	const measurePosition = useCallback(() => {
		if (!isTourActive || !step) return;
		const el = findVisibleTarget(step.selector);
		setTargetRect(el ? el.getBoundingClientRect() : null);
	}, [isTourActive, step]);

	const scheduleMeasure = useCallback(() => {
		if (rafRef.current !== null) return;
		rafRef.current = requestAnimationFrame(() => {
			rafRef.current = null;
			measurePosition();
		});
	}, [measurePosition]);

	// One-shot per step: scrolls the target into view exactly once when the step changes.
	// Previously `updatePosition` was both the scroll handler AND the thing calling
	// `scrollIntoView`, so a smooth scroll's own intermediate `scroll` events kept
	// re-triggering another `scrollIntoView` — a feedback loop that never settled. That only
	// showed up once a target sat below the fold (desktop nav steps like budgets/categories/
	// settings, once the sidebar has enough items to overflow), which is why early steps
	// looked fine while later ones looked "stuck".
	useEffect(() => {
		if (!isTourActive || !step) return;
		const el = findVisibleTarget(step.selector);
		if (el) {
			el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
		measurePosition();
	}, [isTourActive, step, measurePosition]);

	useEffect(() => {
		window.addEventListener('resize', scheduleMeasure);
		window.addEventListener('scroll', scheduleMeasure, true);
		// Catches the mobile nav sheet opening (AppShell opens it automatically on a narrow
		// viewport while a nav-targeted step is active — see AppShell.tsx): that's a DOM/
		// attribute change, not a resize or scroll, so without this the overlay kept measuring
		// the still-hidden desktop copy until some unrelated resize/scroll happened to fire.
		// Mutations inside the overlay's own portal are ignored — every re-render changes this
		// card's own position/style attributes, which would otherwise re-trigger itself forever.
		const observer = new MutationObserver((mutations) => {
			const isExternal = mutations.some(
				(m) => !portalRootRef.current || !portalRootRef.current.contains(m.target as Node)
			);
			if (isExternal) scheduleMeasure();
		});
		observer.observe(document.body, { childList: true, subtree: true, attributes: true });
		return () => {
			window.removeEventListener('resize', scheduleMeasure);
			window.removeEventListener('scroll', scheduleMeasure, true);
			observer.disconnect();
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
		};
	}, [scheduleMeasure]);

	// Fallback safety net while no target has been found yet: resize/scroll/DOM-mutation
	// signals are all indirect (something else has to actually fire them), and under enough
	// load a frame can be missed — a nav-targeted step whose sheet AppShell is still in the
	// middle of opening would otherwise stay stuck on the centered fallback indefinitely.
	// Stops itself the moment a target is found.
	useEffect(() => {
		if (!isTourActive || !step || targetRect) return;
		const handle = setInterval(measurePosition, 200);
		return () => clearInterval(handle);
	}, [isTourActive, step, targetRect, measurePosition]);

	// Real card height instead of a hardcoded guess: description length varies per step, so a
	// fixed constant made the "flip above if near the bottom" heuristic misfire on longer steps.
	useLayoutEffect(() => {
		if (cardRef.current) setCardHeight(cardRef.current.getBoundingClientRect().height);
	}, [step, targetRect]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (!isTourActive) return;
			if (e.key === 'Escape') {
				skipTour();
				return;
			}
			// Traps Tab within the card: without this, a keyboard user tabbing past its last
			// control continued into the underlying page instead of cycling back, since the
			// overlay was never a real modal.
			if (e.key === 'Tab' && cardRef.current) {
				const focusable = Array.from(
					cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
				);
				if (focusable.length === 0) return;
				const first = focusable[0];
				const last = focusable[focusable.length - 1];
				if (e.shiftKey && document.activeElement === first) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [isTourActive, skipTour]);

	// Moves focus into the dialog on mount and on every step change — otherwise a keyboard/
	// screen-reader user's focus stayed wherever it was on the underlying page, with no
	// indication a dialog had opened on top of it.
	useEffect(() => {
		if (isTourActive && cardRef.current) {
			cardRef.current.focus();
		}
	}, [isTourActive, currentStep]);

	if (!isTourActive || !step) {
		return null;
	}

	// Determine placement (simplified: below if there's space, else above)
	const padding = 16;
	const cardWidth = 320;

	let top: number;
	let left: number;

	if (targetRect) {
		top = targetRect.bottom + padding;
		left = targetRect.left;

		// Adjust if it goes off-screen right
		if (left + cardWidth > window.innerWidth) {
			left = window.innerWidth - cardWidth - padding;
		}

		// Adjust if it goes off-screen bottom
		if (top + cardHeight > window.innerHeight) {
			top = targetRect.top - cardHeight - padding;
		}

		// Fallback if target is not visible at all (should be rare due to scrollIntoView)
		if (top < 0) top = padding;
		if (left < 0) left = padding;
	} else {
		// If target not found, center the modal as a fallback
		top = window.innerHeight / 2 - cardHeight / 2;
		left = window.innerWidth / 2 - cardWidth / 2;
	}

	const overlay = (
		<div
			ref={portalRootRef}
			data-testid="quick-tour-backdrop"
			// Higher than any Sheet/Dialog primitive (both use z-50): on a narrow viewport the
			// tour can auto-open the mobile nav sheet on top of itself (see AppShell.tsx), and
			// since both portal to document.body, equal z-index left DOM insertion order to
			// decide stacking — the sheet, mounted after, could paint over the tour and block
			// its own Skip/Next controls.
			className="pointer-events-none fixed inset-0 z-[100]"
			style={{
				boxShadow: targetRect ? `0 0 0 9999px rgba(0, 0, 0, 0.5)` : 'none',
				clipPath: targetRect
					? `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
              ${targetRect.left - 4}px ${targetRect.top - 4}px,
              ${targetRect.left - 4}px ${targetRect.bottom + 4}px,
              ${targetRect.right + 4}px ${targetRect.bottom + 4}px,
              ${targetRect.right + 4}px ${targetRect.top - 4}px,
              ${targetRect.left - 4}px ${targetRect.top - 4}px)`
					: 'none',
				transition: 'all 0.3s ease-in-out'
			}}
		>
			<div
				ref={cardRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={TITLE_ID}
				aria-describedby={DESCRIPTION_ID}
				tabIndex={-1}
				className="pointer-events-auto absolute shadow-xl outline-none"
				style={{
					top: `${top}px`,
					left: `${left}px`,
					width: `${cardWidth}px`,
					transition: 'all 0.3s ease-in-out'
				}}
			>
				<Card className="w-full border-primary/20 shadow-lg">
					<CardHeader className="relative p-4 pb-2">
						<Button
							variant="ghost"
							size="icon"
							className="absolute top-2 right-2 h-6 w-6 text-muted-foreground hover:text-foreground"
							onClick={skipTour}
							aria-label="Close tour"
						>
							<X className="h-4 w-4" />
						</Button>
						<CardTitle id={TITLE_ID} className="text-lg">
							{step.title}
						</CardTitle>
						<CardDescription className="text-sm">
							Step {currentStep + 1} of {totalSteps}
						</CardDescription>
					</CardHeader>
					<CardContent className="p-4 pt-2">
						<p id={DESCRIPTION_ID} className="text-sm text-foreground/90">
							{step.description}
						</p>
					</CardContent>
					<CardFooter className="flex items-center justify-between p-4 pt-0">
						<Button
							variant="ghost"
							size="sm"
							onClick={skipTour}
							className="text-xs text-muted-foreground"
						>
							Skip Tour
						</Button>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="icon"
								onClick={prevStep}
								disabled={currentStep === 0}
								className="h-8 w-8"
							>
								<ChevronLeft className="h-4 w-4" />
							</Button>
							<Button variant="default" size="sm" onClick={nextStep} className="h-8">
								{currentStep === totalSteps - 1 ? (
									'Finish'
								) : (
									<>
										Next <ChevronRight className="ml-1 h-4 w-4" />
									</>
								)}
							</Button>
						</div>
					</CardFooter>
				</Card>
			</div>
		</div>
	);

	return createPortal(overlay, document.body);
}
