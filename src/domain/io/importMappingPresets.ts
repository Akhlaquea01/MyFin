import type { ColumnMapping } from '../../data/io/importService';
import type { ImportMappingPreset } from '../entities';

/** What a preset stores — everything but the identity and bookkeeping the repository adds. */
export type ImportMappingPresetInput = Omit<ImportMappingPreset, 'id' | 'createdAt' | 'updatedAt'>;

/** The columns and format a preset restores, with every column already resolved to a real header. */
export interface ResolvedImportMapping {
	dateColumn: string;
	dateFormat: string;
	amountSignConvention: ColumnMapping['amountSignConvention'];
	amountColumn: string | null;
	debitColumn: string | null;
	creditColumn: string | null;
	descriptionColumn: string | null;
	accountColumn: string | null;
}

/** Case, surrounding space and runs of space are noise in a bank's header row ("Txn  Date "). */
function normalizeHeader(header: string): string {
	return header.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * What a file layout is recognised by: its header names, normalized and sorted so a bank that
 * reorders its columns still matches. Exact on the SET of headers — a file with an extra or
 * renamed column is a different layout and is asked about again, rather than half-guessed.
 */
export function headerSignature(headers: string[]): string {
	return JSON.stringify(headers.map(normalizeHeader).sort());
}

/** The header in `headers` that `saved` names (compared normalized), as it is spelled in this file. */
function resolveColumn(headers: string[], saved: string | null): string | null | undefined {
	if (saved === null) return null;
	const wanted = normalizeHeader(saved);
	// undefined = "named, but this file has no such column".
	return headers.find((header) => normalizeHeader(header) === wanted);
}

/**
 * The mapping the user just used, in the form worth remembering. The destination account is left
 * out on purpose — see `ImportMappingPreset`.
 */
export function presetFromMapping(
	headers: string[],
	mapping: ColumnMapping
): ImportMappingPresetInput {
	const separate = mapping.amountSignConvention === 'separate-debit-credit-columns';
	return {
		signature: headerSignature(headers),
		dateColumn: mapping.dateColumn,
		dateFormat: mapping.dateFormat,
		amountSignConvention: mapping.amountSignConvention,
		amountColumn: separate ? null : mapping.amountColumn || null,
		debitColumn: separate ? (mapping.debitColumn ?? null) : null,
		creditColumn: separate ? (mapping.creditColumn ?? null) : null,
		descriptionColumn: mapping.descriptionColumn ?? null,
		accountColumn: mapping.accountColumn ?? null
	};
}

/**
 * Turns a saved preset back into columns of THIS file. Null when the preset cannot be applied
 * whole — a column it needs is not among `headers` — so a stale preset is ignored rather than
 * applied in part.
 */
export function resolvePreset(
	preset: ImportMappingPresetInput,
	headers: string[]
): ResolvedImportMapping | null {
	const dateColumn = resolveColumn(headers, preset.dateColumn);
	const amountColumn = resolveColumn(headers, preset.amountColumn);
	const debitColumn = resolveColumn(headers, preset.debitColumn);
	const creditColumn = resolveColumn(headers, preset.creditColumn);
	const descriptionColumn = resolveColumn(headers, preset.descriptionColumn);
	const accountColumn = resolveColumn(headers, preset.accountColumn);
	if (
		dateColumn === undefined ||
		dateColumn === null ||
		amountColumn === undefined ||
		debitColumn === undefined ||
		creditColumn === undefined ||
		descriptionColumn === undefined ||
		accountColumn === undefined
	) {
		return null;
	}
	const separate = preset.amountSignConvention === 'separate-debit-credit-columns';
	// The columns the chosen convention actually needs must be there.
	if (separate ? !debitColumn || !creditColumn : !amountColumn) return null;
	return {
		dateColumn,
		dateFormat: preset.dateFormat,
		amountSignConvention: preset.amountSignConvention,
		amountColumn,
		debitColumn,
		creditColumn,
		descriptionColumn,
		accountColumn
	};
}
