import type { InvestmentType } from '../entities';

/** How each kind of holding is named on screen. */
export const INVESTMENT_TYPE_LABELS: Record<InvestmentType, string> = {
	stock: 'Stock',
	mutual_fund: 'Mutual Fund',
	etf: 'ETF',
	bond: 'Bond',
	fixed_deposit: 'Fixed Deposit',
	crypto: 'Crypto',
	other: 'Other'
};
