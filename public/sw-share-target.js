// Spec 008 (Share-to-Quick-Add): a minimal, hand-written service worker — plain JavaScript,
// not compiled, since it needs no build step (contracts/share-target.md). Registered by
// src/App.tsx at the narrow scope "/share-target" (no trailing slash — must match the
// manifest's share_target action path exactly; see research.md §2), independently of the
// root service worker vite-plugin-pwa generates for offline asset caching. It only ever
// intercepts a POST navigation to that exact URL (the OS share, or this feature's E2E
// test's submitted form); everything else falls through untouched.

const SHARE_TARGET_CACHE = 'share-target-buffer';
// Anything a share left behind that the app never picked up (it was shared and the app never
// opened, or the id was never followed) is plaintext, so it must not linger. A day is long
// enough for "shared while locked, unlocked later".
const SHARE_TTL_MS = 24 * 60 * 60 * 1000;
// Mirrors src/lib/imageAttachment.ts: a bigger file would be refused by the app anyway.
const MAX_SHARED_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SHARED_TEXT_CHARS = 20000;

self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

function resolveSharedText(fields) {
	// Duplicates src/lib/shareTarget.ts's parseSharedText priority (text > url > title) —
	// this plain-JS worker script can't import that module. Keep both in sync if either
	// changes (tasks.md T007).
	if (fields.text) return fields.text;
	if (fields.url) return fields.url;
	if (fields.title) return fields.title;
	return null;
}

async function pruneStaleShares(cache, now) {
	for (const request of await cache.keys()) {
		const path = new URL(request.url).pathname;
		if (!path.startsWith('/share-target-meta/')) continue;
		const response = await cache.match(request);
		const meta = response ? await response.json().catch(() => null) : null;
		const savedAt = meta && typeof meta.savedAt === 'number' ? meta.savedAt : 0;
		if (now - savedAt <= SHARE_TTL_MS) continue;
		await cache.delete(request);
		await cache.delete(`/share-target-file/${path.slice('/share-target-meta/'.length)}`);
	}
}

async function handleShareTarget(request) {
	const formData = await request.formData();
	const resolvedText = resolveSharedText({
		text: formData.get('text'),
		url: formData.get('url'),
		title: formData.get('title')
	});
	const sharedText = resolvedText ? String(resolvedText).slice(0, MAX_SHARED_TEXT_CHARS) : null;
	const file = formData.get('file');

	const id = crypto.randomUUID();
	const cache = await caches.open(SHARE_TARGET_CACHE);
	const now = Date.now();
	await pruneStaleShares(cache, now).catch(() => undefined);

	await cache.put(
		`/share-target-meta/${id}`,
		new Response(JSON.stringify({ sharedText, savedAt: now }), {
			headers: { 'Content-Type': 'application/json' }
		})
	);

	if (file instanceof File && file.size > 0 && file.size <= MAX_SHARED_FILE_BYTES) {
		await cache.put(
			`/share-target-file/${id}`,
			new Response(file, {
				headers: { 'Content-Type': file.type, 'X-File-Name': file.name }
			})
		);
	}

	return Response.redirect(`/share-target-landing?id=${id}`, 303);
}

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (event.request.method === 'POST' && url.pathname === '/share-target') {
		event.respondWith(handleShareTarget(event.request));
	}
});
