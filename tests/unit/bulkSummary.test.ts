import { describe, expect, it } from 'vitest';
import {
	summarizeBulkCategory,
	summarizeBulkDelete
} from '../../src/domain/transactions/bulkActions';

describe('summarizeBulkDelete', () => {
	it('reports a clean delete as a success', () => {
		expect(summarizeBulkDelete({ deleted: 3, linked: 0, failed: 0 })).toEqual({
			message: 'Deleted 3 transactions.',
			partial: false
		});
		expect(summarizeBulkDelete({ deleted: 1, linked: 0, failed: 0 }).message).toBe(
			'Deleted 1 transaction.'
		);
	});

	it('says what was kept back and where to deal with it', () => {
		const { message, partial } = summarizeBulkDelete({ deleted: 2, linked: 1, failed: 0 });
		expect(partial).toBe(true);
		expect(message).toBe(
			'Deleted 2 transactions. 1 entry belonging to a loan, payment or investment was kept; undo it from the page that owns it.'
		);
		expect(summarizeBulkDelete({ deleted: 0, linked: 2, failed: 0 }).message).toContain(
			'Nothing was deleted. 2 entries belonging to a loan, payment or investment were kept; undo them'
		);
	});

	it('reports failures', () => {
		expect(summarizeBulkDelete({ deleted: 1, linked: 0, failed: 2 })).toMatchObject({
			message: 'Deleted 1 transaction. 2 entries could not be deleted.',
			partial: true
		});
	});
});

describe('summarizeBulkCategory', () => {
	it('reports a clean update as a success', () => {
		expect(
			summarizeBulkCategory({ updated: 4, transfers: 0, split: 0, linked: 0, failed: 0 })
		).toEqual({ message: 'Updated 4 transactions.', partial: false });
	});

	it('lists each reason something was skipped', () => {
		const { message, partial } = summarizeBulkCategory({
			updated: 1,
			transfers: 2,
			split: 1,
			linked: 1,
			failed: 0
		});
		expect(partial).toBe(true);
		expect(message).toBe(
			'Updated 1 transaction. Skipped: 2 transfers (no category), 1 already split across categories, 1 belonging to a loan, payment or investment.'
		);
	});

	it('says plainly when nothing changed', () => {
		expect(
			summarizeBulkCategory({ updated: 0, transfers: 1, split: 0, linked: 0, failed: 1 }).message
		).toBe('Nothing was changed. Skipped: 1 transfer (no category). 1 could not be updated.');
	});
});
