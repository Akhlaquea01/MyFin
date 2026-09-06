import { describe, it, expect } from 'vitest';
import { validateAttachmentFile } from '../../src/lib/imageAttachment';

function makeFile(name: string, type: string, sizeBytes: number): File {
	return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe('validateAttachmentFile', () => {
	it('accepts a JPEG under the size cap', () => {
		const result = validateAttachmentFile(makeFile('receipt.jpg', 'image/jpeg', 1024));
		expect(result.ok).toBe(true);
	});

	it('accepts PNG and WebP too', () => {
		expect(validateAttachmentFile(makeFile('a.png', 'image/png', 1024)).ok).toBe(true);
		expect(validateAttachmentFile(makeFile('a.webp', 'image/webp', 1024)).ok).toBe(true);
	});

	it('rejects an unsupported file type', () => {
		const result = validateAttachmentFile(makeFile('receipt.pdf', 'application/pdf', 1024));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/JPEG|PNG|WebP|image/i);
	});

	it('rejects a file above the raw-input size cap', () => {
		const oversized = 21 * 1024 * 1024; // 21MB, above the 20MB cap
		const result = validateAttachmentFile(makeFile('huge.jpg', 'image/jpeg', oversized));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/large|size|MB/i);
	});

	it('accepts a file exactly at the size cap', () => {
		const atCap = 20 * 1024 * 1024;
		const result = validateAttachmentFile(makeFile('atcap.jpg', 'image/jpeg', atCap));
		expect(result.ok).toBe(true);
	});
});
