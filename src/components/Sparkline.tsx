import { useEffect, useRef } from 'react';
import {
	Chart,
	LineController,
	LineElement,
	PointElement,
	LinearScale,
	CategoryScale
} from 'chart.js';
import { getPrimaryColor } from '../lib/chartColors';
import { useResolvedTheme } from '../lib/theme';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale);

/** A minimal, axis-less trend line for dashboard cards (User Story 3). */
export function Sparkline({ values, color }: { values: number[]; color?: string }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const chartRef = useRef<Chart | null>(null);
	// The line color is read from the DOM, so a theme change has to redraw it.
	const theme = useResolvedTheme();

	useEffect(() => {
		if (!canvasRef.current) return;
		chartRef.current = new Chart(canvasRef.current, {
			type: 'line',
			data: {
				labels: values.map((_, i) => i),
				datasets: [
					{
						data: values,
						borderColor: color ?? getPrimaryColor(),
						borderWidth: 2,
						pointRadius: 0,
						tension: 0.35
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				scales: { x: { display: false }, y: { display: false } },
				plugins: { legend: { display: false }, tooltip: { enabled: false } }
			}
		});
		return () => chartRef.current?.destroy();
	}, [values, color, theme]);

	return (
		<div className="h-10 w-full">
			{/* Decorative: the number it trends is always rendered as text right next to it. */}
			<canvas ref={canvasRef} aria-hidden="true" />
		</div>
	);
}
