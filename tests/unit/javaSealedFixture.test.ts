import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { openSealedItem, type SealedCaptureItem } from '../../src/data/crypto/sealedBox';

// The Android side seals messages in Java; the app opens them in WebCrypto. This opens an item
// produced by the REAL android/.../capture/SealedBox.java (run on a desktop JVM — see
// tests/fixtures/MakeSealedFixture.java), so a disagreement about the format fails here instead
// of showing up on a phone as messages that never appear.
interface Fixture {
	privateKeyPkcs8: string;
	payload: unknown;
	item: SealedCaptureItem;
}

const fixture = JSON.parse(
	readFileSync(new URL('../fixtures/javaSealedItem.json', import.meta.url), 'utf-8')
) as Fixture;

describe('an item sealed by the Java implementation', () => {
	async function privateKey() {
		const der = Uint8Array.from(Buffer.from(fixture.privateKeyPkcs8, 'base64'));
		return crypto.subtle.importKey('pkcs8', der, { name: 'RSA-OAEP', hash: 'SHA-1' }, false, [
			'decrypt'
		]);
	}

	it('opens with WebCrypto and yields the original message', async () => {
		expect(await openSealedItem(await privateKey(), fixture.item)).toEqual(fixture.payload);
	});

	it('is rejected if any part was altered', async () => {
		const key = await privateKey();
		const flip = (b64: string) => {
			const bytes = Buffer.from(b64, 'base64');
			bytes[0] ^= 0x01;
			return bytes.toString('base64');
		};
		for (const field of ['wk', 'iv', 'ct'] as const) {
			await expect(
				openSealedItem(key, { ...fixture.item, [field]: flip(fixture.item[field]) })
			).rejects.toBeDefined();
		}
	});
});
