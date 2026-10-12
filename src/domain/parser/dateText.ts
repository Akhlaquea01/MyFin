// Reads a calendar date out of free text — a pasted bank SMS or a captured notification. Day-first,
// as Indian bank messages write dates ("12/10/2026", "12-Oct-26", "12 October 2026") and ISO
// ("2026-10-12"). Shared by Quick Add and the Android capture parser so both read the same dates.
import type { ISODateString } from '../entities';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function toIso(year: number, month: number, day: number): ISODateString | null {
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const fullYear = year < 100 ? 2000 + year : year;
	const probe = new Date(Date.UTC(fullYear, month - 1, day));
	// Rejects 31 Feb and the like: the date rolls over into the next month.
	if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
	return `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const DATE_ISO = /\b(20\d{2})-(\d{2})-(\d{2})\b/;
const DATE_NUMERIC = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/;
const DATE_NAMED =
	/\b(\d{1,2})[-\s]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s,]*(\d{4}|\d{2})\b/i;

/** The first date `text` states, or null if it states none (or one that does not exist). */
export function parseDateFromText(text: string): ISODateString | null {
	const iso = DATE_ISO.exec(text);
	if (iso) {
		const result = toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
		if (result) return result;
	}
	const named = DATE_NAMED.exec(text);
	if (named) {
		const result = toIso(
			Number(named[3]),
			MONTHS.indexOf(named[2].toLowerCase()) + 1,
			Number(named[1])
		);
		if (result) return result;
	}
	const numeric = DATE_NUMERIC.exec(text);
	if (numeric) {
		const result = toIso(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
		if (result) return result;
	}
	return null;
}
