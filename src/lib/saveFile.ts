import { Capacitor } from '@capacitor/core';
import { saveAs } from 'file-saver';

// Chunked so a multi-megabyte workbook can't overflow the argument limit of `String.fromCharCode`.
const BASE64_CHUNK_BYTES = 0x8000;

async function blobToBase64(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	for (let i = 0; i < bytes.length; i += BASE64_CHUNK_BYTES) {
		binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_BYTES));
	}
	return btoa(binary);
}

/**
 * Hands a generated file to the user: a browser download on the web, the Android share sheet
 * (Save to Drive / Files, or send elsewhere) inside the Capacitor APK.
 *
 * Needed because the Android WebView silently ignores `<a download>` on blob URLs, which is
 * how `file-saver` works — without this, every export and backup button would do nothing in
 * the APK. The plugins are imported lazily so the web bundle never pays for them.
 *
 * Rejects with `Error('Save cancelled.')` when the user dismisses the share sheet, so callers'
 * existing `catch` blocks report it instead of announcing a file that was never saved.
 */
export async function saveFile(blob: Blob, filename: string): Promise<void> {
	if (!Capacitor.isNativePlatform()) {
		saveAs(blob, filename);
		return;
	}

	const [{ Filesystem, Directory }, { Share }] = await Promise.all([
		import('@capacitor/filesystem'),
		import('@capacitor/share')
	]);
	const { uri } = await Filesystem.writeFile({
		path: filename,
		data: await blobToBase64(blob),
		directory: Directory.Cache
	});
	try {
		await Share.share({ title: filename, url: uri, dialogTitle: 'Save or share' });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(/cancel/i.test(message) ? 'Save cancelled.' : message, { cause: err });
	}
}
