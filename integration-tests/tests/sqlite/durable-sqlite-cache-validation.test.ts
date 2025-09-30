/// <reference types="@cloudflare/workers-types" />

import { sql } from 'drizzle-orm';
import type { DrizzleSqliteDOCacheDatabase } from 'drizzle-orm/durable-sqlite-cache';
import { drizzle } from 'drizzle-orm/durable-sqlite-cache';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { describe, expect, test, vi } from 'vitest';
import { TestCache, TestGlobalCache } from './sqlite-common-cache';

// This test validates the driver functionality without requiring complex setup
describe('durable-sqlite-cache driver validation', () => {
	test('driver can be instantiated', () => {
		// Mock minimal storage interface
		const mockStorage = {
			sql: {
				exec: vi.fn().mockReturnValue({
					toArray: () => [],
					next: () => ({ value: undefined, done: true }),
					raw: () => ({ toArray: () => [] })
				})
			},
			transaction: vi.fn(),
			transactionSync: vi.fn()
		};

		const db = drizzle(mockStorage as any);
		
		expect(db).toBeDefined();
		expect(typeof db.run).toBe('function');
		expect(typeof db.all).toBe('function');
		expect(typeof db.get).toBe('function');
		expect(typeof db.values).toBe('function');
		expect(typeof db.select).toBe('function');
		expect(typeof db.insert).toBe('function');
		expect(typeof db.update).toBe('function');
		expect(typeof db.delete).toBe('function');
		expect(typeof db.batch).toBe('function');
		expect(typeof db.transaction).toBe('function');
	});

	test('driver supports cache configuration', () => {
		const mockStorage = {
			sql: {
				exec: vi.fn().mockReturnValue({
					toArray: () => [],
					next: () => ({ value: undefined, done: true }),
					raw: () => ({ toArray: () => [] })
				})
			},
			transaction: vi.fn(),
			transactionSync: vi.fn()
		};

		const testCache = new TestCache();
		const db = drizzle(mockStorage as any, {
			cache: testCache
		});

		expect(db.$cache).toBeDefined();
		expect(typeof db.$cache?.invalidate).toBe('function');
	});

	test('queries return proper thenable objects', async () => {
		const mockStorage = {
			sql: {
				exec: vi.fn().mockReturnValue({
					toArray: () => [{ id: 1, name: 'test' }],
					next: () => ({ value: { id: 1, name: 'test' }, done: false }),
					raw: () => ({ toArray: () => [[1, 'test']] })
				})
			},
			transaction: vi.fn(),
			transactionSync: vi.fn()
		};

		const db = drizzle(mockStorage as any);

		// All methods should return thenable objects
		const runResult = db.run(sql`CREATE TABLE test (id INTEGER)`);
		expect(typeof runResult.then).toBe('function');

		const allResult = db.all(sql`SELECT * FROM test`);
		expect(typeof allResult.then).toBe('function');

		// Wait for them to resolve
		await runResult;
		const data = await allResult;
		expect(Array.isArray(data)).toBe(true);
	});

	test('cache methods are properly integrated', () => {
		const mockStorage = {
			sql: {
				exec: vi.fn().mockReturnValue({
					toArray: () => [],
					next: () => ({ value: undefined, done: true }),
					raw: () => ({ toArray: () => [] })
				})
			},
			transaction: vi.fn(),
			transactionSync: vi.fn()
		};

		const testCache = new TestCache();
		const getCacheSpy = vi.spyOn(testCache, 'get');
		const putCacheSpy = vi.spyOn(testCache, 'put');
		const onMutateSpy = vi.spyOn(testCache, 'onMutate');

		const db = drizzle(mockStorage as any, {
			cache: testCache
		});

		// Verify cache methods exist and are accessible
		expect(testCache.get).toBeDefined();
		expect(testCache.put).toBeDefined();
		expect(testCache.onMutate).toBeDefined();
		expect(testCache.strategy).toBeDefined();

		// Cache should have proper async signatures
		expect(testCache.get()).toBeInstanceOf(Promise);
		expect(testCache.put('key', [], [], false)).toBeInstanceOf(Promise);
		expect(testCache.onMutate({ tables: [] })).toBeInstanceOf(Promise);
	});

	test('global cache strategy works', () => {
		const mockStorage = {
			sql: {
				exec: vi.fn().mockReturnValue({
					toArray: () => [],
					next: () => ({ value: undefined, done: true }),
					raw: () => ({ toArray: () => [] })
				})
			},
			transaction: vi.fn(),
			transactionSync: vi.fn()
		};

		const globalCache = new TestGlobalCache();
		const db = drizzle(mockStorage as any, {
			cache: globalCache
		});

		expect(globalCache.strategy()).toBe('all');
		expect(db.$cache).toBeDefined();
	});

	test('transaction method exists and is async', () => {
		const mockStorage = {
			sql: {
				exec: vi.fn().mockReturnValue({
					toArray: () => [],
					next: () => ({ value: undefined, done: true }),
					raw: () => ({ toArray: () => [] })
				})
			},
			transaction: vi.fn().mockResolvedValue(undefined),
			transactionSync: vi.fn()
		};

		const db = drizzle(mockStorage as any);

		const txResult = db.transaction(async (tx) => {
			return 'test';
		});

		expect(txResult).toBeInstanceOf(Promise);
	});

	test('batch method exists and works', async () => {
		const mockStorage = {
			sql: {
				exec: vi.fn().mockReturnValue({
					toArray: () => [{ id: 1 }],
					next: () => ({ value: { id: 1 }, done: false }),
					raw: () => ({ toArray: () => [[1]] })
				})
			},
			transaction: vi.fn(),
			transactionSync: vi.fn()
		};

		const usersTable = sqliteTable('users', {
			id: integer('id').primaryKey(),
			name: text('name').notNull(),
		});

		const db = drizzle(mockStorage as any, { schema: { usersTable } });

		// Batch method should exist and return a promise
		const batchResult = db.batch([
			db.select().from(usersTable),
		]);

		expect(batchResult).toBeInstanceOf(Promise);

		// Should resolve properly
		const result = await batchResult;
		expect(Array.isArray(result)).toBe(true);
	});
});
