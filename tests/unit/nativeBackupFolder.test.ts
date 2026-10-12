import { describe, it, expect } from 'vitest';
import { isFolderPickCancelled, utf8ToBase64 } from '../../src/lib/native/nativeBackupFolder';

describe('utf8ToBase64', () => {
	const decode = (b64: string) => Buffer.from(b64, 'base64').toString('utf8');

	it('round-trips ASCII and non-ASCII text', () => {
		expect(decode(utf8ToBase64('{"a":1}'))).toBe('{"a":1}');
		expect(decode(utf8ToBase64('₹1,234.50 — नमस्ते'))).toBe('₹1,234.50 — नमस्ते');
	});

	it('handles text far larger than one chunk without overflowing the call stack', () => {
		const big = 'x'.repeat(5 * 1024 * 1024);
		expect(decode(utf8ToBase64(big))).toHaveLength(big.length);
	});

	it('is empty for empty text', () => {
		expect(utf8ToBase64('')).toBe('');
	});
});

describe('isFolderPickCancelled', () => {
	it('recognises the plugin’s cancel code and nothing else', () => {
		expect(isFolderPickCancelled({ code: 'cancelled' })).toBe(true);
		expect(isFolderPickCancelled({ code: 'permission' })).toBe(false);
		expect(isFolderPickCancelled(new Error('x'))).toBe(false);
		expect(isFolderPickCancelled(null)).toBe(false);
	});
});
