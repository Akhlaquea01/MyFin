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

/**
 * Applies a fixed alpha to a color string, for chart fills. Browsers keep a computed `oklch()` (the
 * format index.css is written in) as `oklch(...)` or `color(srgb ...)` rather than converting it to
 * `rgb()`, so those take the alpha after a slash; without this the fill came out fully opaque.
 */
export function withAlpha(color: string, alpha: number): string {
	const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(color);
	if (rgb) {
		const [, r, g, b] = rgb;
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
	const modern = /^(oklch|oklab|lch|lab|hwb|color)\((.*?)(?:\s*\/\s*[^)]*)?\)$/.exec(color.trim());
	return modern ? `${modern[1]}(${modern[2]} / ${alpha})` : color;
}
