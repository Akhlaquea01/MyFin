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

	it('sends a shared bank statement to Import', () => {
		const statement = new File(['date,amount'], 'statement.csv', { type: 'text/csv' });
		expect(resolveShareDestination({ sharedText: null, file: null, statement })).toEqual({
			to: '/import',
			state: { sharedFile: statement }
		});
	});

	it('prefers a photo over a statement, and a statement over loose text', () => {
		const statement = new File(['x'], 'statement.csv', { type: 'text/csv' });
		expect(resolveShareDestination({ sharedText: 't', file, statement })?.to).toBe(
			'/transactions/new'
		);
		expect(resolveShareDestination({ sharedText: 't', file: null, statement })?.to).toBe('/import');
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
			file: null,
			statement: null
		});
	});

	it('turns a shared statement into a File of its own kind, separate from a photo', () => {
		const payload = sharedPayloadFromNative({
			file: { name: 'statement.csv', mimeType: 'text/csv', base64: btoa('date,amount') }
		});
		expect(payload.file).toBeNull();
		expect(payload.statement).toBeInstanceOf(File);
		expect(payload.statement?.name).toBe('statement.csv');
		expect(payload.statement?.type).toBe('text/csv');
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
		expect(payload).toEqual({ sharedText: null, file: null, statement: null });
		expect(resolveShareDestination(payload)).toBeNull();
	});
});
