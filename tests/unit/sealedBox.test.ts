import { describe, it, expect } from 'vitest';
import {
	constants,
	createCipheriv,
	generateKeyPairSync,
	publicEncrypt,
	randomBytes
} from 'node:crypto';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';
import {
	createSealingKey,
	loadSealingPrivateKey,
	openSealedItem,
	sealItem,
	type SealedCaptureItem
} from '../../src/data/crypto/sealedBox';

const payload = {
	channel: 'sms',
	sender: 'VM-HDFCBK',
	body: 'Rs.250.00 debited from A/c XX1234 to SWIGGY',
	receivedAt: 1_791_000_000_000
};

async function newDataKey() {
	return deriveEncryptionKey('8383', randomSaltBase64());
}

describe('sealed box', () => {
	it('opens what was sealed to its public key, after the private key was stored and reloaded', async () => {
		const dataKey = await newDataKey();
		const material = await createSealingKey(dataKey);

		const item = await sealItem(material.publicKey, material.keyId, payload);
		const privateKey = await loadSealingPrivateKey(dataKey, material.wrappedPrivateKey);

		expect(item).toMatchObject({ v: 1, kid: material.keyId });
		expect(await openSealedItem(privateKey, item)).toEqual(payload);
	});

	it('keeps the message out of the sealed item', async () => {
		const material = await createSealingKey(await newDataKey());
		const item = await sealItem(material.publicKey, material.keyId, payload);
		const serialized = JSON.stringify(item);
		expect(serialized).not.toContain('SWIGGY');
		expect(serialized).not.toContain('HDFC');
	});

	it('cannot be opened without the data key that protects the private key', async () => {
		const material = await createSealingKey(await newDataKey());
		await expect(
			loadSealingPrivateKey(await newDataKey(), material.wrappedPrivateKey)
		).rejects.toBeDefined();
	});

	it('refuses an item sealed to a different key pair', async () => {
		const dataKey = await newDataKey();
		const mine = await createSealingKey(dataKey);
		const other = await createSealingKey(dataKey);
		const item = await sealItem(other.publicKey, other.keyId, payload);
		const privateKey = await loadSealingPrivateKey(dataKey, mine.wrappedPrivateKey);
		await expect(openSealedItem(privateKey, item)).rejects.toBeDefined();
	});

	it('refuses a tampered item', async () => {
		const dataKey = await newDataKey();
		const material = await createSealingKey(dataKey);
		const item = await sealItem(material.publicKey, material.keyId, payload);
		const bytes = Uint8Array.from(atob(item.ct), (c) => c.charCodeAt(0));
		bytes[0] ^= 0xff;
		const tampered: SealedCaptureItem = {
			...item,
			ct: btoa(String.fromCharCode(...bytes))
		};
		const privateKey = await loadSealingPrivateKey(dataKey, material.wrappedPrivateKey);
		await expect(openSealedItem(privateKey, tampered)).rejects.toBeDefined();
	});

	it('uses a fresh AES key and IV for every item', async () => {
		const material = await createSealingKey(await newDataKey());
		const a = await sealItem(material.publicKey, material.keyId, payload);
		const b = await sealItem(material.publicKey, material.keyId, payload);
		expect(a.iv).not.toBe(b.iv);
		expect(a.wk).not.toBe(b.wk);
		expect(a.ct).not.toBe(b.ct);
	});

	// The Android side is written in Java, which this suite cannot run. This reproduces its recipe
	// with Node's crypto — RSA-2048, OAEP with SHA-1/MGF1-SHA-1, AES-256-GCM with the tag appended
	// to the ciphertext — so a mismatch in the WIRE FORMAT shows up here rather than on a phone.
	it('opens an item produced the way the Java implementation produces it', async () => {
		const dataKey = await newDataKey();
		const material = await createSealingKey(dataKey);
		const spki = Buffer.from(material.publicKey, 'base64');
		const publicKeyObject = (await import('node:crypto')).createPublicKey({
			key: spki,
			format: 'der',
			type: 'spki'
		});

		const aesKey = randomBytes(32);
		const iv = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
		const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
		const ct = Buffer.concat([body, cipher.getAuthTag()]);
		const wk = publicEncrypt(
			{ key: publicKeyObject, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
			aesKey
		);

		const item: SealedCaptureItem = {
			v: 1,
			id: 'java-made',
			kid: material.keyId,
			wk: wk.toString('base64'),
			iv: iv.toString('base64'),
			ct: ct.toString('base64')
		};
		const privateKey = await loadSealingPrivateKey(dataKey, material.wrappedPrivateKey);
		expect(await openSealedItem(privateKey, item)).toEqual(payload);
	});

	it('accepts a public key exported by a Java/Node-style X.509 SPKI encoder', () => {
		const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
		const spki = publicKey.export({ format: 'der', type: 'spki' });
		return expect(
			sealItem(spki.toString('base64'), 'kid', payload).then((item) => item.v)
		).resolves.toBe(1);
	});
});
