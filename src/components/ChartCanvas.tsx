import { useEffect, useRef } from 'react';
import { Chart, Filler, type ChartConfiguration } from 'chart.js';

// `fill: true` draws nothing (and warns on every render) unless this plugin is registered.
Chart.register(Filler);

type ValueFormatter = (value: number) => string;

/**
 * The chart's numbers as a table only screen readers see: a canvas gives them one label and nothing
 * to move through. Built from the same config the chart draws, so the two cannot disagree.
 */
export function ChartDataTable({
	config,
	label,
	formatValue = String
}: {
	config: ChartConfiguration;
	label: string;
	formatValue?: ValueFormatter;
}) {
	const labels = config.data.labels ?? [];
	const datasets = config.data.datasets;
	return (
		// Named with aria-label, not a <caption>, so its text is not matched as page content.
		<table className="sr-only" aria-label={`${label.split(':')[0]}, data table`}>
			<thead>
				<tr>
					<th scope="col">Label</th>
					{datasets.map((dataset, i) => (
						<th key={i} scope="col">
							{dataset.label ?? `Series ${i + 1}`}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{labels.map((rowLabel, row) => (
					<tr key={row}>
						<th scope="row">{String(rowLabel)}</th>
						{datasets.map((dataset, i) => {
							const value = dataset.data[row];
							return <td key={i}>{typeof value === 'number' ? formatValue(value) : 'No data'}</td>;
						})}
					</tr>
				))}
			</tbody>
		</table>
	);
}

/** Mounts/updates/destroys a Chart.js chart on a canvas as `config` changes. Shared by
 *  AnalyticsPage, FinancialHealthPage, NetWorthPage and CashFlowForecastPage. A new `config`
 *  rebuilds the whole chart, so callers memoize it. */
export function ChartCanvas({
	config,
	label,
	formatValue
}: {
	config: ChartConfiguration;
	label: string;
	formatValue?: ValueFormatter;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const chartRef = useRef<Chart | null>(null);

	useEffect(() => {
		if (!canvasRef.current) return;
		chartRef.current = new Chart(canvasRef.current, config);
		return () => chartRef.current?.destroy();
	}, [config]);

	return (
		<div className="h-64 w-full">
			<canvas ref={canvasRef} role="img" aria-label={label} />
			<ChartDataTable config={config} label={label} formatValue={formatValue} />
		</div>
	);
}
