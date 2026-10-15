import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * public/sw-share-target.js is plain JS that only runs inside a service worker, so it is loaded
 * here into a sandbox with an in-memory Cache API. What matters: whatever a share leaves behind
 * and the app never collects must expire, and an oversized share must not be buffered.
 */
const SOURCE = readFileSync('public/sw-share-target.js', 'utf-8');
const DAY_MS = 24 * 60 * 60 * 1000;

class FakeCache {
	entries = new Map<string, Response>();
	private key(request: string | Request): string {
		const raw = typeof request === 'string' ? request : request.url;
		return new URL(raw, 'https://myfin.test').pathname;
	}
	async put(request: string, response: Response) {
		this.entries.set(this.key(request), response);
	}
	async match(request: string | Request) {
		return this.entries.get(this.key(request))?.clone();
	}
	async delete(request: string | Request) {
		return this.entries.delete(this.key(request));
	}
	async keys() {
		return [...this.entries.keys()].map((path) => new Request(`https://myfin.test${path}`));
	}
}

function loadWorker(cache: FakeCache, now: () => number) {
	let onFetch: ((event: unknown) => void) | undefined;
	class SandboxResponse extends Response {
		static override redirect(url: string | URL, status?: number) {
			return new Response(null, { status, headers: { Location: String(url) } });
		}
	}
	const DateStub = Object.assign(function () {}, { now });
	runInNewContext(SOURCE, {
		self: {
			addEventListener: (type: string, listener: (event: unknown) => void) => {
				if (type === 'fetch') onFetch = listener;
			},
			skipWaiting: () => undefined,
			clients: { claim: () => undefined }
		},
		caches: { open: async () => cache },
		crypto: { randomUUID: () => `id-${Math.random().toString(36).slice(2)}` },
		Response: SandboxResponse,
		File,
		URL,
		String,
		Date: DateStub
	});
	return async (form: FormData) => {
		let responded: Promise<Response> | undefined;
		onFetch?.({
			request: {
				method: 'POST',
				url: 'https://myfin.test/share-target',
				formData: async () => form
			},
			respondWith: (promise: Promise<Response>) => {
				responded = promise;
			}
		});
		return responded!;
	};
}

function shareText(text: string) {
	const form = new FormData();
	form.set('text', text);
	return form;
}

describe('share-target service worker', () => {
	let cache: FakeCache;
	let clock: number;

	beforeEach(() => {
		cache = new FakeCache();
		clock = 1_000_000_000_000;
	});

	it('stores a text share and redirects to the landing page with its id', async () => {
		const share = loadWorker(cache, () => clock);
		const response = await share(shareText('Rs.500 debited from A/c XX1234'));
		expect(response.status).toBe(303);
		const id = new URL(response.headers.get('Location')!, 'https://myfin.test').searchParams.get(
			'id'
		);
		const meta = await (await cache.match(`/share-target-meta/${id}`))!.json();
		expect(meta).toMatchObject({ sharedText: 'Rs.500 debited from A/c XX1234', savedAt: clock });
	});

	it('discards shares nobody collected within a day, but keeps recent ones', async () => {
		const share = loadWorker(cache, () => clock);
		await share(shareText('old share'));
		clock += DAY_MS - 1000;
		await share(shareText('recent share'));
		expect(cache.entries.size).toBe(2);

		clock += 2000; // the first is now older than a day
		await share(shareText('newest share'));
		const texts = await Promise.all(
			[...cache.entries.values()].map(async (r) => (await r.clone().json()).sharedText)
		);
		expect(texts.sort()).toEqual(['newest share', 'recent share']);
	});

	it('removes an expired share’s file along with its text', async () => {
		const share = loadWorker(cache, () => clock);
		const withFile = new FormData();
		withFile.set('text', 'receipt');
		withFile.set('file', new File([new Uint8Array(10)], 'r.jpg', { type: 'image/jpeg' }));
		await share(withFile);
		expect([...cache.entries.keys()].some((k) => k.startsWith('/share-target-file/'))).toBe(true);

		clock += DAY_MS + 1;
		await share(shareText('later'));
		expect([...cache.entries.keys()].some((k) => k.startsWith('/share-target-file/'))).toBe(false);
	});

	it('does not buffer a file larger than the app would accept, and caps absurd text', async () => {
		const share = loadWorker(cache, () => clock);
		const form = new FormData();
		form.set('text', 'x'.repeat(50_000));
		form.set(
			'file',
			new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'huge.jpg', { type: 'image/jpeg' })
		);
		await share(form);
		expect([...cache.entries.keys()].some((k) => k.startsWith('/share-target-file/'))).toBe(false);
		const [metaResponse] = [...cache.entries.values()];
		expect((await metaResponse.json()).sharedText).toHaveLength(20_000);
	});
});
