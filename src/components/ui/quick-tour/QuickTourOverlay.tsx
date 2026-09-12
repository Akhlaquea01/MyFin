import { useEffect, useState, useCallback } from 'react';
import { useQuickTour } from '../../../hooks/useQuickTour';
import { QUICK_TOUR_STEPS } from './tour-steps';
import { Button } from '../button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../card';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { createPortal } from 'react-dom';

export function QuickTourOverlay() {
  const { isTourActive, currentStep, nextStep, prevStep, skipTour, totalSteps } = useQuickTour();
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const step = QUICK_TOUR_STEPS[currentStep];

  const updatePosition = useCallback(() => {
    if (!isTourActive || !step) return;
    
    const el = document.querySelector(step.selector);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
      // Scroll into view if needed
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      setTargetRect(null);
    }
  }, [isTourActive, step]);

  useEffect(() => {
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [updatePosition]);

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
  
  let top = 0;
  let left = 0;

  if (targetRect) {
    top = targetRect.bottom + padding;
    left = targetRect.left;
    
    // Adjust if it goes off-screen right
    if (left + cardWidth > window.innerWidth) {
      left = window.innerWidth - cardWidth - padding;
    }
    
    // Adjust if it goes off-screen bottom
    if (top + 200 > window.innerHeight) { // assuming card height is ~200px
      top = targetRect.top - 200 - padding;
    }
    
    // Fallback if target is not visible at all (should be rare due to scrollIntoView)
    if (top < 0) top = padding;
    if (left < 0) left = padding;
  } else {
    // If target not found, center the modal as a fallback
    top = window.innerHeight / 2 - 100;
    left = window.innerWidth / 2 - cardWidth / 2;
  }

  const overlay = (
    <div 
      className="fixed inset-0 z-50 pointer-events-none"
      style={{
        boxShadow: targetRect 
          ? `0 0 0 9999px rgba(0, 0, 0, 0.5)` 
          : 'none',
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
        className="absolute pointer-events-auto shadow-xl"
        style={{
          top: `${top}px`,
          left: `${left}px`,
          width: `${cardWidth}px`,
          transition: 'all 0.3s ease-in-out'
        }}
      >
        <Card className="w-full border-primary/20 shadow-lg">
          <CardHeader className="p-4 pb-2 relative">
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
          <CardFooter className="p-4 pt-0 flex justify-between items-center">
            <Button variant="ghost" size="sm" onClick={skipTour} className="text-muted-foreground text-xs">
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
              <Button 
                variant="default" 
                size="sm" 
                onClick={nextStep}
                className="h-8"
              >
                {currentStep === totalSteps - 1 ? 'Finish' : (
                  <>Next <ChevronRight className="h-4 w-4 ml-1" /></>
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
