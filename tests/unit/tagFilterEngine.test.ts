import { describe, it, expect } from 'vitest';
import {
	matchesAnyTag,
	normalizeTagText,
	tagNameMatchesQuery,
	filterTagOptions,
	distinctTagIdsInUse,
	transactionMatchesFreeText
} from '../../src/domain/transactions/tagFilterEngine';
import type { TagOption } from '../../src/domain/transactions/tagFilterEngine';

describe('matchesAnyTag', () => {
	it('matches when the transaction carries at least one selected tag', () => {
		expect(matchesAnyTag(['a', 'b'], ['b', 'c'])).toBe(true);
	});

	it('does not match when no selected tag is carried', () => {
		expect(matchesAnyTag(['a', 'b'], ['c', 'd'])).toBe(false);
	});

	it('treats an empty selection as no filter — everything matches', () => {
		expect(matchesAnyTag(['a', 'b'], [])).toBe(true);
		expect(matchesAnyTag([], [])).toBe(true);
	});

	it('does not match a transaction with no tags against a non-empty selection', () => {
		expect(matchesAnyTag([], ['a'])).toBe(false);
	});
});

describe('normalizeTagText', () => {
	it('trims and lowercases', () => {
		expect(normalizeTagText('  Trip:Japan  ')).toBe('trip:japan');
	});
});

describe('tagNameMatchesQuery', () => {
	it('matches case-insensitively', () => {
		expect(tagNameMatchesQuery('Trip:Japan', 'JAPAN')).toBe(true);
	});

	it('matches a partial substring', () => {
		expect(tagNameMatchesQuery('trip:japan', 'trip')).toBe(true);
	});

	it('does not match unrelated text', () => {
		expect(tagNameMatchesQuery('reimbursable', 'japan')).toBe(false);
	});

	it('treats an empty query as matching everything', () => {
		expect(tagNameMatchesQuery('reimbursable', '')).toBe(true);
	});
});

describe('filterTagOptions', () => {
	const options: TagOption[] = [
		{ id: '1', name: 'trip:japan' },
		{ id: '2', name: 'reimbursable' },
		{ id: '3', name: 'trip:goa' }
	];

	it('narrows to options whose name matches the query', () => {
		expect(filterTagOptions(options, 'trip')).toEqual([
			{ id: '1', name: 'trip:japan' },
			{ id: '3', name: 'trip:goa' }
		]);
	});

	it('preserves input order', () => {
		expect(filterTagOptions(options, '')).toEqual(options);
	});

	it('returns an empty array when nothing matches', () => {
		expect(filterTagOptions(options, 'zzz')).toEqual([]);
	});
});

describe('distinctTagIdsInUse', () => {
	it('excludes a tag referenced only by a deleted transaction', () => {
		const rows = [{ transactionId: 'deleted-tx', tagId: 'tag-1' }];
		const live = new Set<string>();
		expect(distinctTagIdsInUse(rows, live)).toEqual(new Set());
	});

	it('includes a tag referenced by a live transaction', () => {
		const rows = [{ transactionId: 'live-tx', tagId: 'tag-1' }];
		const live = new Set(['live-tx']);
		expect(distinctTagIdsInUse(rows, live)).toEqual(new Set(['tag-1']));
	});

	it('includes a tag referenced by both a live and a deleted transaction', () => {
		const rows = [
			{ transactionId: 'live-tx', tagId: 'tag-1' },
			{ transactionId: 'deleted-tx', tagId: 'tag-1' }
		];
		const live = new Set(['live-tx']);
		expect(distinctTagIdsInUse(rows, live)).toEqual(new Set(['tag-1']));
	});

	it('returns an empty set for no rows', () => {
		expect(distinctTagIdsInUse([], new Set())).toEqual(new Set());
	});
});

describe('transactionMatchesFreeText', () => {
	it('matches on notes', () => {
		expect(transactionMatchesFreeText('Coffee with team', [], 'coffee')).toBe(true);
	});

	it('matches on a tag name when notes do not match', () => {
		expect(transactionMatchesFreeText('Lunch', ['trip:japan'], 'japan')).toBe(true);
	});

	it('matches a partial tag name', () => {
		expect(transactionMatchesFreeText(null, ['trip:japan'], 'japan')).toBe(true);
	});

	it('returns false when neither notes nor any tag matches', () => {
		expect(transactionMatchesFreeText('Lunch', ['reimbursable'], 'japan')).toBe(false);
	});

	it('handles null notes with no tags', () => {
		expect(transactionMatchesFreeText(null, [], 'anything')).toBe(false);
	});
});
