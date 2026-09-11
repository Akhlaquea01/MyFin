/**
 * Parsing and formatting for monetary values (Constitution Principle VI: money is always an
 * integer in the smallest currency unit, never floating point).
 *
 * Pure — no I/O, no framework. Every user-facing amount entry point in the app funnels
 * through `parseMoneyToMinorUnits`, replacing the previous `Math.round(parseFloat(v) * 100)`
 * idiom, which was wrong in three distinct ways:
 *
 *   1. `parseFloat` stops at the first invalid character, so "1,234.56" silently parsed as
 *      `1` — a ₹1,234.56 entry became ₹1.00 with no error anywhere. Thousands separators are
 *      the default in most bank CSV exports and in anything a user pastes.
 *   2. `parseFloat` accepts trailing garbage: "50abc" parsed as `50`.
 *   3. Scaling through binary floating point loses a unit at exact half-subunit boundaries:
 *      `Math.round(8.165 * 100)` is 816, not 817, because 8.165 is not representable.
 *
 * This module never multiplies a fractional float. It splits the decimal string and
 * assembles the integer directly, so the scaling step is exact by construction.
 */

/** Subunits per major unit (paise per rupee). */
const MINOR_UNITS_PER_MAJOR = 100;
const MINOR_UNIT_DIGITS = 2;

/**
 * Parses a user-entered decimal amount into an exact integer count of minor units, or
 * `null` if the input is not a well-formed amount.
 *
 * Accepts an optional sign, grouping separators (`,`, spaces, `_`), and up to two decimal
 * places. Rejects anything else outright rather than coercing — a rejected value becomes a
 * visible validation error, which is always better than a silently wrong balance.
 */
export function parseMoneyToMinorUnits(raw: string | number | null | undefined): number | null {
	if (raw === null || raw === undefined) return null;

	// A number input is already unambiguous; route it through the same exactness guarantee by
	// formatting it to a fixed-precision string first.
	const text =
		typeof raw === 'number' ? (Number.isFinite(raw) ? raw.toFixed(MINOR_UNIT_DIGITS) : '') : raw;

	const normalized = text.trim().replace(/[,\s_]/g, '');
	if (normalized === '') return null;

	const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(normalized);
	if (!match) return null;

	const [, sign, whole = '', frac = ''] = match;
	// Require at least one digit somewhere: "." and "-" alone are not amounts.
	if (whole === '' && frac === '') return null;
	if (frac.length > MINOR_UNIT_DIGITS) return null;

	const majorPart = whole === '' ? 0 : Number(whole);
	const minorPart = frac === '' ? 0 : Number(frac.padEnd(MINOR_UNIT_DIGITS, '0'));
	if (!Number.isSafeInteger(majorPart)) return null;

	const magnitude = majorPart * MINOR_UNITS_PER_MAJOR + minorPart;
	if (!Number.isSafeInteger(magnitude)) return null;

	return sign === '-' ? -magnitude : magnitude;
}

/**
 * Same as `parseMoneyToMinorUnits` but collapses a rejected value to `0`, for the few call
 * sites that have already validated the input through `isValidMoney` and need a plain number.
 */
export function parseMoneyOrZero(raw: string | number | null | undefined): number {
	return parseMoneyToMinorUnits(raw) ?? 0;
}

/** Whether `raw` is a well-formed amount. Use in schema validation before parsing. */
export function isValidMoney(raw: string | number | null | undefined): boolean {
	return parseMoneyToMinorUnits(raw) !== null;
}

/** Whether `raw` is a well-formed amount strictly greater than zero. */
export function isPositiveMoney(raw: string | number | null | undefined): boolean {
	const parsed = parseMoneyToMinorUnits(raw);
	return parsed !== null && parsed > 0;
}

/** Whether `raw` is a well-formed amount of zero or more. */
export function isNonNegativeMoney(raw: string | number | null | undefined): boolean {
	const parsed = parseMoneyToMinorUnits(raw);
	return parsed !== null && parsed >= 0;
}

/** Whether `raw` is a well-formed, non-zero amount (a goal contribution may be negative). */
export function isNonZeroMoney(raw: string | number | null | undefined): boolean {
	const parsed = parseMoneyToMinorUnits(raw);
	return parsed !== null && parsed !== 0;
}

/**
 * Renders minor units back to a plain decimal string ("123456" → "1234.56"). Exact: built by
 * integer division, never by dividing into a float.
 */
export function formatMinorUnits(minorUnits: number): string {
	const negative = minorUnits < 0;
	const magnitude = Math.abs(Math.trunc(minorUnits));
	const major = Math.trunc(magnitude / MINOR_UNITS_PER_MAJOR);
	const minor = magnitude % MINOR_UNITS_PER_MAJOR;
	return `${negative ? '-' : ''}${major}.${String(minor).padStart(MINOR_UNIT_DIGITS, '0')}`;
}
