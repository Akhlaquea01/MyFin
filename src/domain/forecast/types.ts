export type ForecastHorizonDays = 30 | 60 | 90;

export interface ForecastPoint {
	date: string; // ISO date
	projectedBalanceMinor: number;
}

export interface ForecastWarning {
	/** 'low-balance': an ordinary account is projected below its threshold. 'over-limit': a credit
	 *  card's projected amount owed is projected to exceed its credit limit. */
	kind: 'low-balance' | 'over-limit';
	date: string; // ISO date — first day the trajectory crosses the threshold
	shortfallAmountMinor: number; // positive: how far past the threshold (below it / over the limit)
}

export interface BalanceForecast {
	accountId: string;
	horizonDays: ForecastHorizonDays;
	points: ForecastPoint[];
	warning: ForecastWarning | null;
	confidence: 'normal' | 'low';
}
