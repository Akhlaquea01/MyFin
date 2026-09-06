import { useEffect, useRef } from 'react';
import {
	Chart,
	LineController,
	LineElement,
	PointElement,
	LinearScale,
	CategoryScale
} from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale);

/** A minimal, axis-less trend line for dashboard cards (User Story 3). */
export function Sparkline({ values, color = '#0f766e' }: { values: number[]; color?: string }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const chartRef = useRef<Chart | null>(null);

	useEffect(() => {
		if (!canvasRef.current) return;
		chartRef.current = new Chart(canvasRef.current, {
			type: 'line',
			data: {
				labels: values.map((_, i) => i),
				datasets: [
					{
						data: values,
						borderColor: color,
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
	}, [values, color]);

	return (
		<div className="h-10 w-full">
			{/* Decorative: the number it trends is always rendered as text right next to it. */}
			<canvas ref={canvasRef} aria-hidden="true" />
		</div>
	);
}
