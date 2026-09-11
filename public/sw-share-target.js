// Spec 008 (Share-to-Quick-Add): a minimal, hand-written service worker — plain JavaScript,
// not compiled, since it needs no build step (contracts/share-target.md). Registered by
// src/App.tsx at the narrow scope "/share-target" (no trailing slash — must match the
// manifest's share_target action path exactly; see research.md §2), independently of the
// root service worker vite-plugin-pwa generates for offline asset caching. It only ever
// intercepts a POST navigation to that exact URL (the OS share, or this feature's E2E
// test's submitted form); everything else falls through untouched.

const SHARE_TARGET_CACHE = 'share-target-buffer';

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

async function handleShareTarget(request) {
	const formData = await request.formData();
	const sharedText = resolveSharedText({
		text: formData.get('text'),
		url: formData.get('url'),
		title: formData.get('title')
	});
	const file = formData.get('file');

	const id = crypto.randomUUID();
	const cache = await caches.open(SHARE_TARGET_CACHE);

	await cache.put(
		`/share-target-meta/${id}`,
		new Response(JSON.stringify({ sharedText }), {
			headers: { 'Content-Type': 'application/json' }
		})
	);

	if (file instanceof File && file.size > 0) {
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
