// Browser-API utility (Canvas, File) for receipt/photo attachments (spec 005) — not domain
// logic, so it lives here rather than src/domain/ (research.md §2), matching the existing
// convention set by src/lib/webauthn.ts and src/lib/singleInstance.ts.

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_RAW_BYTES = 20 * 1024 * 1024; // 20MB (research.md §7)
const MAX_DIMENSION_PX = 1600; // research.md §2
const JPEG_QUALITY = 0.8;
/**
 * Ceiling on the *compressed* bytes actually stored. Attachments are base64-encoded once into
 * the entity and the AES-GCM ciphertext is base64-encoded again, so a stored byte costs roughly
 * 1.78x on disk; without a cap a handful of large receipts can exhaust the origin quota, after
 * which every write starts failing.
 */
const MAX_STORED_BYTES = 2 * 1024 * 1024;

export type AttachmentValidationResult = { ok: true } | { ok: false; reason: string };

/** FR-004: checked before any processing — type allowlist and a raw-input size cap. */
export function validateAttachmentFile(file: File): AttachmentValidationResult {
	if (!ALLOWED_MIME_TYPES.has(file.type)) {
		return { ok: false, reason: 'Only JPEG, PNG, or WebP images are supported.' };
	}
	if (file.size > MAX_RAW_BYTES) {
		return { ok: false, reason: 'That file is too large (max 20MB).' };
	}
	return { ok: true };
}

export interface CompressedImage {
	mimeType: string;
	/** Base64-encoded, no `data:` URL prefix. */
	data: string;
	sizeBytes: number;
}

/**
 * Downscales `file` to at most 1600px on its longest side and re-encodes as JPEG
 * (research.md §2, FR-005/SC-003), returning base64 bytes ready to store on an Attachment
 * entity. Requires a browser environment (createImageBitmap + canvas) — not callable from
 * Vitest's Node environment; covered by the E2E suite instead (contracts/attachment-
 * service.md).
 */
export async function compressImage(file: File): Promise<CompressedImage> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		bitmap.close();
		throw new Error('Canvas 2D context unavailable.');
	}
	try {
		ctx.drawImage(bitmap, 0, 0, width, height);
	} finally {
		// Released even if encoding below throws, so a failed attachment doesn't leak the decoded
		// bitmap for the life of the page.
		bitmap.close();
	}

	// PNG sources keep PNG. Re-encoding every upload as JPEG flattened transparency to black and
	// put ringing artefacts on exactly the worst case for JPEG — a screenshot of a statement,
	// which is sharp text on flat colour, and often grew rather than shrank.
	const outputMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';

	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(b) => (b ? resolve(b) : reject(new Error('Image compression failed.'))),
			outputMime,
			outputMime === 'image/jpeg' ? JPEG_QUALITY : undefined
		);
	});

	const arrayBuffer = await blob.arrayBuffer();
	if (arrayBuffer.byteLength > MAX_STORED_BYTES) {
		throw new Error('That image is still too large after compression. Try a smaller photo.');
	}
	return {
		mimeType: outputMime,
		data: arrayBufferToBase64(arrayBuffer),
		sizeBytes: arrayBuffer.byteLength
	};
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	let binary = '';
	const bytes = new Uint8Array(buffer);
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}
