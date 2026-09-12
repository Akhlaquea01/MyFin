import { describe, it, expect } from 'vitest';
import { parseDataTemplate } from '../../src/data/io/templateService';
import type { DataTemplate } from '../../src/data/io/templateTypes';

describe('templateService - parseDataTemplate', () => {
	it('rejects unparseable non-JSON text', () => {
		const res = parseDataTemplate('not json at all');
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.message).toMatch(/invalid JSON/i);
		}
	});

	it('rejects JSON that is not an object', () => {
		const res = parseDataTemplate('["array", "of", "items"]');
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.message).toMatch(/must be a JSON object/i);
		}
	});

	it('rejects JSON with missing or incorrect container property', () => {
		const raw = JSON.stringify({
			container: 'wrong-container',
			templateVersion: 1,
			exportedAt: new Date().toISOString(),
			entities: {}
		});
		const res = parseDataTemplate(raw);
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.message).toMatch(/container/i);
		}
	});

	it('rejects JSON with invalid templateVersion', () => {
		const raw = JSON.stringify({
			container: 'myfin-data-template',
			templateVersion: 0,
			exportedAt: new Date().toISOString(),
			entities: {}
		});
		const res = parseDataTemplate(raw);
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.message).toMatch(/templateVersion/i);
		}
	});

	it('rejects JSON with missing entities object', () => {
		const raw = JSON.stringify({
			container: 'myfin-data-template',
			templateVersion: 1,
			exportedAt: new Date().toISOString()
		});
		const res = parseDataTemplate(raw);
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.message).toMatch(/entities/i);
		}
	});

	it('accepts a valid minimal template and preserves properties while ignoring unknown extra fields', () => {
		const validObj = {
			container: 'myfin-data-template',
			templateVersion: 1,
			exportedAt: '2026-09-12T12:00:00.000Z',
			unknownTopLevelField: 'should be ignored safely',
			entities: {
				accounts: [],
				categories: [],
				transactions: [],
				unknownEntityCollection: [{ foo: 'bar' }]
			}
		};
		const res = parseDataTemplate(JSON.stringify(validObj));
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.template.container).toBe('myfin-data-template');
			expect(res.template.templateVersion).toBe(1);
			expect(res.template.entities.accounts).toEqual([]);
		}
	});
});
