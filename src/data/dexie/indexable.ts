// Real IndexedDB (unlike the fake-indexeddb polyfill used in Node-side tests) rejects
// `null`/`undefined` as an index key or query bound ("Invalid key provided"). Every
// indexed structural column that models an optional value must therefore use a valid,
// non-null sentinel instead — `''` for optional id strings. This helper is the single place
// that mapping happens, so it's applied consistently.

export const NO_LINK = '';

export function nullableIdIndex(value: string | null): string {
	return value ?? NO_LINK;
}
