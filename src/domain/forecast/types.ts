export type ForecastHorizonDays = 30 | 60 | 90;

export interface ForecastPoint {
	date: string; // ISO date
	projectedBalanceMinor: number;
}

export interface ForecastWarning {
	date: string; // ISO date — first day the trajectory crosses the threshold
	shortfallAmountMinor: number; // positive: how far below the threshold
}

export interface BalanceForecast {
	accountId: string;
	horizonDays: ForecastHorizonDays;
	points: ForecastPoint[];
	warning: ForecastWarning | null;
	confidence: 'normal' | 'low';
}
