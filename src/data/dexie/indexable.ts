// Real IndexedDB (unlike the fake-indexeddb polyfill used in Node-side tests) rejects
// `null`/`undefined` as an index key or query bound ("Invalid key provided"). Every
// indexed structural column that models an optional value must therefore use a valid,
// non-null sentinel instead — `0` for optional timestamps, `''` for optional id strings.
// These helpers are the single place that mapping happens, so it's applied consistently.

export const NOT_DELETED = 0;
export const NO_LINK = '';

export function deletedAtIndex(deletedAt: number | null): number {
	return deletedAt ?? NOT_DELETED;
}

export function nullableIdIndex(value: string | null): string {
	return value ?? NO_LINK;
}
