// Spec 008 (Share-to-Quick-Add): browser-API utility for the single POST share_target
// hand-off (research.md §2) — not domain logic, so it lives here rather than src/domain/,
// matching the existing convention set by src/lib/webauthn.ts and src/lib/singleInstance.ts.

import type { NativeSharePayload } from './native/nativeShare';

const SHARE_TARGET_CACHE = 'share-target-buffer';

/**
 * Resolves the text an OS share hands over: `text`, falling back to `url`, then `title`
 * (research.md §4) — an SMS app typically shares its notification body as `text`. Pure and
 * pre-derived from plain string fields (not a live URLSearchParams/FormData) so both the
 * app and the standalone service worker (which duplicates this same priority rule, since a
 * plain-JS worker script in `public/` can't import this module) can agree on the behavior.
 */
export function parseSharedText(fields: {
	text?: string | null;
	url?: string | null;
	title?: string | null;
}): string | null {
	if (fields.text) return fields.text;
	if (fields.url) return fields.url;
	if (fields.title) return fields.title;
	return null;
}

export interface SharedPayload {
	sharedText: string | null;
	file: File | null;
}

/** Where a share goes: a file to the new-transaction screen, text to Quick Add. */
export interface ShareDestination {
	to: '/transactions/new' | '/quick-add';
	state: { sharedFile: File } | { sharedText: string };
}

/**
 * Picks the screen for a share. A file takes priority over text (spec 008, FR-004) — a share
 * carrying both (an image with a caption) still goes to the richer destination. `null` when the
 * share carried nothing usable.
 */
export function resolveShareDestination(payload: SharedPayload): ShareDestination | null {
	if (payload.file) return { to: '/transactions/new', state: { sharedFile: payload.file } };
	if (payload.sharedText) return { to: '/quick-add', state: { sharedText: payload.sharedText } };
	return null;
}

/** Turns what the Android app handed over into the same shape the web share path produces. */
export function sharedPayloadFromNative(native: NativeSharePayload): SharedPayload {
	const sharedText = parseSharedText({ text: native.text, title: native.subject });
	let file: File | null = null;
	if (native.image) {
		const bytes = Uint8Array.from(atob(native.image.base64), (c) => c.charCodeAt(0));
		file = new File([bytes], native.image.name, { type: native.image.mimeType });
	}
	return { sharedText, file };
}

/**
 * Reads the Cache API entry `public/sw-share-target.js` wrote for `id` and deletes it in
 * the same call, so a given `id` can only ever be consumed once (contracts/share-target.md).
 * Requires the Cache API — not callable from Vitest's Node environment.
 */
export async function readAndClearSharedPayload(id: string): Promise<SharedPayload> {
	const cache = await caches.open(SHARE_TARGET_CACHE);

	const metaResponse = await cache.match(`/share-target-meta/${id}`);
	const sharedText: string | null = metaResponse ? (await metaResponse.json()).sharedText : null;
	if (metaResponse) await cache.delete(`/share-target-meta/${id}`);

	const fileResponse = await cache.match(`/share-target-file/${id}`);
	let file: File | null = null;
	if (fileResponse) {
		const blob = await fileResponse.blob();
		const name = fileResponse.headers.get('X-File-Name') ?? 'shared-image';
		file = new File([blob], name, { type: blob.type });
		await cache.delete(`/share-target-file/${id}`);
	}

	return { sharedText, file };
}
