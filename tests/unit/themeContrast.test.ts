import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Reads the tokens straight from index.css so a palette tweak that breaks contrast in either theme
// fails here rather than on someone's phone. WCAG 2.x ratios: 4.5 for text, 3 for graphics.
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');

function tokens(selector: string): Record<string, string> {
	const start = css.indexOf(`\n${selector} {`);
	const body = css.slice(start, css.indexOf('\n}', start));
	return Object.fromEntries(
		[...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])
	);
}

type Rgb = [number, number, number];

function oklchToLinear(l: number, c: number, hueDeg: number): Rgb {
	const h = (hueDeg * Math.PI) / 180;
	const a = c * Math.cos(h);
	const b = c * Math.sin(h);
	const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const clamp = (v: number) => Math.min(1, Math.max(0, v));
	return [
		clamp(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
		clamp(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
		clamp(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3)
	];
}

function toLinear(value: string): Rgb {
	if (value.startsWith('#')) {
		const n = parseInt(value.slice(1), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
			const s = v / 255;
			return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
		}) as Rgb;
	}
	const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
	if (!match) throw new Error(`Unsupported colour token: ${value}`);
	return oklchToLinear(Number(match[1]), Number(match[2]), Number(match[3]));
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(toLinear(a)), luminance(toLinear(b))].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

const themes = {
	light: tokens(':root'),
	dark: { ...tokens(':root'), ...tokens('.dark') }
};

describe.each(Object.entries(themes))('%s theme contrast', (_name, t) => {
	it('keeps body and secondary text readable on every surface', () => {
		for (const surface of ['background', 'card', 'muted']) {
			expect(contrast(t.foreground, t[surface])).toBeGreaterThanOrEqual(4.5);
			expect(contrast(t['muted-foreground'], t[surface])).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('keeps primary text and filled buttons readable', () => {
		expect(contrast(t.primary, t.background)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(t['primary-foreground'], t.primary)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(t.destructive, t.card)).toBeGreaterThanOrEqual(4.5);
	});

	it('keeps money and status colours readable as text on cards and muted surfaces', () => {
		for (const status of ['income', 'expense', 'warning', 'info']) {
			expect(contrast(t[status], t.card), `${status} on card`).toBeGreaterThanOrEqual(4.5);
			expect(contrast(t[status], t.muted), `${status} on muted`).toBeGreaterThanOrEqual(4.5);
		}
		// The review-queue badge is `bg-warning text-background`.
		expect(contrast(t.background, t.warning)).toBeGreaterThanOrEqual(4.5);
	});

	it('keeps category and chart colours distinguishable from the card as graphics', () => {
		for (let i = 1; i <= 8; i++) {
			expect(contrast(t[`cat-${i}`], t.card), `cat-${i}`).toBeGreaterThanOrEqual(3);
		}
		for (let i = 1; i <= 5; i++) {
			expect(contrast(t[`chart-${i}`], t.card), `chart-${i}`).toBeGreaterThanOrEqual(3);
		}
	});

	it('keeps the focus ring visible', () => {
		expect(contrast(t.ring, t.background)).toBeGreaterThanOrEqual(3);
	});
});
