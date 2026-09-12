/**
 * Resolves a CSS custom property (defined in oklch — see index.css) to a literal color string
 * a `<canvas>` 2D context (and therefore Chart.js) can use as a fillStyle/strokeStyle. Reading
 * `getComputedStyle(...).getPropertyValue(varName)` directly can hand back the raw `oklch(...)`
 * source text depending on the engine, so this instead sets the property as a `color` on a
 * detached probe element and reads its *computed* `color`, which browsers normalize to an
 * `rgb()`/`color()` string canvas always accepts.
 */
export function resolveCssColor(varName: string): string {
	const probe = document.createElement('span');
	probe.style.color = `var(${varName})`;
	probe.style.display = 'none';
	document.body.appendChild(probe);
	const resolved = getComputedStyle(probe).color;
	probe.remove();
	return resolved;
}

/** The five chart-series colors (`--chart-1`..`--chart-5`), in order. */
export function getChartPalette(): string[] {
	return ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'].map(resolveCssColor);
}

export function getAxisColor(): string {
	return resolveCssColor('--muted-foreground');
}

export function getGridColor(): string {
	return resolveCssColor('--border');
}

export function getPrimaryColor(): string {
	return resolveCssColor('--primary');
}

/** Applies a fixed alpha to an `rgb(r, g, b)`/`rgba(r, g, b, a)` string, for chart fills. */
export function withAlpha(rgbColor: string, alpha: number): string {
	const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(rgbColor);
	if (!match) return rgbColor;
	const [, r, g, b] = match;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
