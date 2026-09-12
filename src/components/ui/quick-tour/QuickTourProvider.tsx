import { createContext, useEffect, useState, type ReactNode } from 'react';
import { db } from '../../../data/dexie/db';

export const APP_QUICK_TOUR_SEEN = 'APP_QUICK_TOUR_SEEN';

interface QuickTourContextType {
  isTourActive: boolean;
  currentStep: number;
  startTour: () => void;
  skipTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  totalSteps: number;
}

export const QuickTourContext = createContext<QuickTourContextType | undefined>(undefined);

export function QuickTourProvider({ children, totalSteps }: { children: ReactNode, totalSteps: number }) {
  const [isTourActive, setIsTourActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const checkInitialTour = async () => {
      const seen = localStorage.getItem(APP_QUICK_TOUR_SEEN);
      if (seen === 'true') {
        return;
      }

      // Check if user has any existing data
      try {
        const accountsCount = await db.accounts.count();
        const transactionsCount = await db.transactions.count();

        if (accountsCount === 0 && transactionsCount === 0) {
          setIsTourActive(true);
        }
      } catch (error) {
        console.error('Error checking DB for quick tour', error);
      }
    };

    checkInitialTour();
  }, []);

  const startTour = () => {
    setCurrentStep(0);
    setIsTourActive(true);
  };

  const skipTour = () => {
    setIsTourActive(false);
    localStorage.setItem(APP_QUICK_TOUR_SEEN, 'true');
  };

  const nextStep = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      skipTour(); // finish
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  return (
    <QuickTourContext.Provider
      value={{
        isTourActive,
        currentStep,
        startTour,
        skipTour,
        nextStep,
        prevStep,
        totalSteps,
      }}
    >
      {children}
    </QuickTourContext.Provider>
  );
}
