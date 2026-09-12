import { useEffect, useRef } from 'react';
import { Chart, type ChartConfiguration } from 'chart.js';

/** Mounts/updates/destroys a Chart.js chart on a canvas as `config` changes. Shared by
 *  AnalyticsPage, FinancialHealthPage, and NetWorthPage — previously duplicated verbatim in
 *  the first two. */
export function ChartCanvas({ config, label }: { config: ChartConfiguration; label: string }) {
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
		</div>
	);
}
