import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useQuickTour } from '../../../hooks/useQuickTour';
import { QUICK_TOUR_STEPS } from './tour-steps';
import { Button } from '../button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../card';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { createPortal } from 'react-dom';

const DEFAULT_CARD_HEIGHT = 200;

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

export function QuickTourOverlay() {
	const { isTourActive, currentStep, nextStep, prevStep, skipTour, totalSteps } = useQuickTour();
	const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
	const [cardHeight, setCardHeight] = useState(DEFAULT_CARD_HEIGHT);
	const cardRef = useRef<HTMLDivElement>(null);
	const rafRef = useRef<number | null>(null);
	const step = QUICK_TOUR_STEPS[currentStep];

	// Measure-only: never scrolls, so it's safe to call from the scroll listener without
	// re-triggering the very scroll it's reacting to (see the effect below).
	const measurePosition = useCallback(() => {
		if (!isTourActive || !step) return;
		const el = document.querySelector(step.selector);
		setTargetRect(el && isElementVisible(el) ? el.getBoundingClientRect() : null);
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
		const el = document.querySelector(step.selector);
		if (el && isElementVisible(el)) {
			el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
		measurePosition();
	}, [isTourActive, step, measurePosition]);

	useEffect(() => {
		window.addEventListener('resize', scheduleMeasure);
		window.addEventListener('scroll', scheduleMeasure, true);
		return () => {
			window.removeEventListener('resize', scheduleMeasure);
			window.removeEventListener('scroll', scheduleMeasure, true);
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
		};
	}, [scheduleMeasure]);

	// Real card height instead of a hardcoded guess: description length varies per step, so a
	// fixed constant made the "flip above if near the bottom" heuristic misfire on longer steps.
	useLayoutEffect(() => {
		if (cardRef.current) setCardHeight(cardRef.current.getBoundingClientRect().height);
	}, [step, targetRect]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && isTourActive) {
				skipTour();
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [isTourActive, skipTour]);

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
			className="pointer-events-none fixed inset-0 z-50"
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
				className="pointer-events-auto absolute shadow-xl"
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
						<CardTitle className="text-lg">{step.title}</CardTitle>
						<CardDescription className="text-sm">
							Step {currentStep + 1} of {totalSteps}
						</CardDescription>
					</CardHeader>
					<CardContent className="p-4 pt-2">
						<p className="text-sm text-foreground/90">{step.description}</p>
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
