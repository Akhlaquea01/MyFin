export interface TourStep {
  selector: string;
  title: string;
  description: string;
}

export const QUICK_TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="accounts-nav"]',
    title: 'Accounts',
    description: 'Add your bank accounts, credit cards, or cash wallets here to keep track of your balances.',
  },
  {
    selector: '[data-tour="transactions-nav"]',
    title: 'Transactions',
    description: 'Log your income and expenses here. You can manually enter them or use the quick SMS import feature.',
  },
  {
    selector: '[data-tour="budgets-nav"]',
    title: 'Budgets',
    description: 'Set monthly limits for your spending categories and monitor your progress.',
  },
  {
    selector: '[data-tour="categories-nav"]',
    title: 'Categorization',
    description: 'Organize your transactions with categories and tags to see exactly where your money goes.',
  },
  {
    selector: '[data-tour="settings-nav"]',
    title: 'Security & Backup',
    description: 'Your data is encrypted by default. Go to settings to manage your PIN and enable automatic backups.',
  }
];
