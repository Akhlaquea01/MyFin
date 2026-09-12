import { useContext } from 'react';
import { QuickTourContext } from '../components/ui/quick-tour/QuickTourProvider';

export function useQuickTour() {
  const context = useContext(QuickTourContext);
  if (context === undefined) {
    throw new Error('useQuickTour must be used within a QuickTourProvider');
  }
  return context;
}
