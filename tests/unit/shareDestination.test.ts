import { describe, it, expect } from 'vitest';
import { resolveShareDestination, sharedPayloadFromNative } from '../../src/lib/shareTarget';

const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });

describe('resolveShareDestination', () => {
	it('sends text to Quick Add', () => {
		expect(resolveShareDestination({ sharedText: 'Rs.5 debited', file: null })).toEqual({
			to: '/quick-add',
			state: { sharedText: 'Rs.5 debited' }
		});
	});

	it('sends a file to New Transaction', () => {
		expect(resolveShareDestination({ sharedText: null, file })).toEqual({
			to: '/transactions/new',
			state: { sharedFile: file }
		});
	});

	it('prefers the file when a share carries both (an image with a caption)', () => {
		expect(resolveShareDestination({ sharedText: 'caption', file })?.to).toBe('/transactions/new');
	});

	it('has nowhere to send an empty share', () => {
		expect(resolveShareDestination({ sharedText: null, file: null })).toBeNull();
		expect(resolveShareDestination({ sharedText: '', file: null })).toBeNull();
	});
});

describe('sharedPayloadFromNative', () => {
	it('uses the text', () => {
		expect(sharedPayloadFromNative({ text: 'Rs.5 debited' })).toEqual({
			sharedText: 'Rs.5 debited',
			file: null
		});
	});

	it('falls back to the subject when there is no text', () => {
		expect(sharedPayloadFromNative({ subject: 'HDFC alert' }).sharedText).toBe('HDFC alert');
	});

	it('prefers the text over the subject', () => {
		expect(sharedPayloadFromNative({ text: 'body', subject: 'subject' }).sharedText).toBe('body');
	});

	it('turns a shared image into a File with its name, type and bytes', async () => {
		const payload = sharedPayloadFromNative({
			image: { name: 'bill.png', mimeType: 'image/png', base64: btoa('PNGDATA') }
		});
		expect(payload.sharedText).toBeNull();
		expect(payload.file).toBeInstanceOf(File);
		expect(payload.file?.name).toBe('bill.png');
		expect(payload.file?.type).toBe('image/png');
		expect(await payload.file?.text()).toBe('PNGDATA');
	});

	it('has neither text nor file for a share that only reports an image problem', () => {
		const payload = sharedPayloadFromNative({ imageProblem: 'too-large' });
		expect(payload).toEqual({ sharedText: null, file: null });
		expect(resolveShareDestination(payload)).toBeNull();
	});
});
