import { describe, it, expect, vi, beforeEach } from 'vitest';

const { isNativePlatform, saveAs, writeFile, share } = vi.hoisted(() => ({
	isNativePlatform: vi.fn(),
	saveAs: vi.fn(),
	writeFile: vi.fn(),
	share: vi.fn()
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform } }));
vi.mock('file-saver', () => ({ saveAs }));
vi.mock('@capacitor/filesystem', () => ({
	Filesystem: { writeFile },
	Directory: { Cache: 'CACHE' }
}));
vi.mock('@capacitor/share', () => ({ Share: { share } }));

import { saveFile } from '../../src/lib/saveFile';

describe('saveFile', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		writeFile.mockResolvedValue({ uri: 'file:///cache/out.json' });
		share.mockResolvedValue({});
	});

	it('downloads through file-saver in a normal browser', async () => {
		isNativePlatform.mockReturnValue(false);
		const blob = new Blob(['{}'], { type: 'application/json' });

		await saveFile(blob, 'out.json');

		expect(saveAs).toHaveBeenCalledWith(blob, 'out.json');
		expect(writeFile).not.toHaveBeenCalled();
		expect(share).not.toHaveBeenCalled();
	});

	it('writes the file to the cache and opens the share sheet inside the Android app', async () => {
		isNativePlatform.mockReturnValue(true);

		await saveFile(new Blob(['hello'], { type: 'text/plain' }), 'out.json');

		expect(saveAs).not.toHaveBeenCalled();
		expect(writeFile).toHaveBeenCalledWith({
			path: 'out.json',
			data: btoa('hello'),
			directory: 'CACHE'
		});
		expect(share).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'out.json', url: 'file:///cache/out.json' })
		);
	});

	it('base64-encodes binary content larger than one chunk without corrupting it', async () => {
		isNativePlatform.mockReturnValue(true);
		const bytes = Uint8Array.from({ length: 0x8000 * 2 + 5 }, (_, i) => i % 256);

		await saveFile(new Blob([bytes]), 'big.xlsx');

		const { data } = writeFile.mock.calls[0][0] as { data: string };
		const decoded = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
		expect(decoded).toEqual(bytes);
	});

	it('reports a dismissed share sheet as a cancellation, not a success', async () => {
		isNativePlatform.mockReturnValue(true);
		share.mockRejectedValue(new Error('Share canceled'));

		await expect(saveFile(new Blob(['x']), 'out.json')).rejects.toThrow('Save cancelled.');
	});

	it('passes through other share failures unchanged', async () => {
		isNativePlatform.mockReturnValue(true);
		share.mockRejectedValue(new Error('No apps can handle this'));

		await expect(saveFile(new Blob(['x']), 'out.json')).rejects.toThrow('No apps can handle this');
	});
});
