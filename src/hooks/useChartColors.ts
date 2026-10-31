import { useMemo } from 'react';
import {
	getAxisColor,
	getChartPalette,
	getGridColor,
	getPrimaryColor,
	resolveCssColor
} from '../lib/chartColors';
import { useResolvedTheme } from '../lib/theme';

/**
 * The colors a canvas chart needs, read from the DOM once per theme. The object is stable between
 * renders, so chart configs built from it can be memoized (a new config rebuilds the whole chart),
 * and it changes exactly when the theme does, which is what redraws the chart.
 */
export function useChartColors() {
	const theme = useResolvedTheme();
	return useMemo(() => {
		const axis = getAxisColor();
		const grid = getGridColor();
		return {
			theme,
			palette: getChartPalette(),
			axis,
			grid,
			primary: getPrimaryColor(),
			income: resolveCssColor('--income'),
			expense: resolveCssColor('--expense'),
			scales: {
				x: { ticks: { color: axis }, grid: { color: grid } },
				y: { ticks: { color: axis }, grid: { color: grid } }
			}
		};
	}, [theme]);
}
