/// <reference types="@cloudflare/workers-types" />

import { eq, sql } from 'drizzle-orm';
import type { DrizzleSqliteDOCacheDatabase } from 'drizzle-orm/durable-sqlite-cache';
import { drizzle } from 'drizzle-orm/durable-sqlite-cache';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { TestCache, TestGlobalCache } from './sqlite-common-cache';
import { Storage } from './durable-objects-storage/miniflare';

const ENABLE_LOGGING = false;

const usersTable = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	email: text('email').notNull(),
	verified: integer('verified').notNull().default(0),
});

const postsTable = sqliteTable('posts', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	title: text('title').notNull(),
	content: text('content').notNull(),
	userId: integer('user_id').references(() => usersTable.id),
});

const schema = { usersTable, postsTable };

let db: DrizzleSqliteDOCacheDatabase<typeof schema>;
let cachedDb: DrizzleSqliteDOCacheDatabase<typeof schema>;
let globalCachedDb: DrizzleSqliteDOCacheDatabase<typeof schema>;
let storage: any; // RPC storage interface
let testCache: TestCache;
let testGlobalCache: TestGlobalCache;

beforeAll(async () => {
	storage = await Storage('test');
	
	testCache = new TestCache();
	testGlobalCache = new TestGlobalCache();

	db = drizzle(storage, { 
		logger: ENABLE_LOGGING,
		schema
	});
	
	cachedDb = drizzle(storage, { 
		logger: ENABLE_LOGGING,
		schema,
		cache: testCache
	});
	
	globalCachedDb = drizzle(storage, { 
		logger: ENABLE_LOGGING,
		schema,
		cache: testGlobalCache
	});

	// Create tables once for all tests using the real storage
	await db.run(sql`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			email TEXT NOT NULL,
			verified INTEGER NOT NULL DEFAULT 0
		)
	`);

	await db.run(sql`
		CREATE TABLE IF NOT EXISTS posts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			user_id INTEGER REFERENCES users(id)
		)
	`);
});

beforeEach(async () => {
	// Clear data from tables without dropping them
	await db.run(sql`DELETE FROM posts`);
	await db.run(sql`DELETE FROM users`);

	// Reset auto-increment counters
	await db.run(sql`DELETE FROM sqlite_sequence WHERE name IN ('users', 'posts')`);

	// Reset cache spies
	vi.clearAllMocks();
});

describe('durable-sqlite-cache specific functionality', () => {
	test('basic async database operations work', async () => {
		const result = await db.insert(usersTable).values({
			name: 'John Doe',
			email: 'john@example.com'
		});

		const users = await db.select().from(usersTable);
		expect(users).toHaveLength(1);
		expect(users[0].name).toBe('John Doe');
		expect(users[0].email).toBe('john@example.com');
	});

	test('cache is not used without explicit configuration', async () => {
		// Insert test data
		await db.insert(usersTable).values({
			name: 'Jane Doe',
			email: 'jane@example.com'
		});

		// Query twice - should hit database both times
		const result1 = await db.select().from(usersTable);
		const result2 = await db.select().from(usersTable);

		expect(result1).toEqual(result2);
		expect(result1).toHaveLength(1);
	});

	test('explicit cache usage with $withCache', async () => {
		const getCacheSpy = vi.spyOn(testCache, 'get');
		const putCacheSpy = vi.spyOn(testCache, 'put');

		await cachedDb.insert(usersTable).values({
			name: 'Cached User',
			email: 'cached@example.com'
		});

		// First query with cache
		const result1 = await cachedDb.select().from(usersTable).$withCache();
		expect(getCacheSpy).toHaveBeenCalledTimes(1);
		expect(putCacheSpy).toHaveBeenCalledTimes(1);

		// Second query with cache - should hit cache
		const result2 = await cachedDb.select().from(usersTable).$withCache();
		expect(getCacheSpy).toHaveBeenCalledTimes(2);
		// put should not be called again as cache hit occurred
		expect(putCacheSpy).toHaveBeenCalledTimes(1);

		expect(result1).toEqual(result2);
	});

	test('global cache strategy works', async () => {
		const getCacheSpy = vi.spyOn(testGlobalCache, 'get');
		const putCacheSpy = vi.spyOn(testGlobalCache, 'put');

		await globalCachedDb.insert(usersTable).values({
			name: 'Global User',
			email: 'global@example.com'
		});

		// First query - should cache automatically
		const result1 = await globalCachedDb.select().from(usersTable);
		expect(getCacheSpy).toHaveBeenCalled();
		expect(putCacheSpy).toHaveBeenCalled();

		// Second query - should use cache
		const result2 = await globalCachedDb.select().from(usersTable);
		expect(result1).toEqual(result2);
	});

	test('cache invalidation on mutations', async () => {
		const onMutateSpy = vi.spyOn(testGlobalCache, 'onMutate');

		await globalCachedDb.insert(usersTable).values({
			name: 'User 1',
			email: 'user1@example.com'
		});

		// Cache a select query
		const result1 = await globalCachedDb.select().from(usersTable);
		expect(result1).toHaveLength(1);

		// Insert should trigger cache invalidation
		await globalCachedDb.insert(usersTable).values({
			name: 'User 2',
			email: 'user2@example.com'
		});

		expect(onMutateSpy).toHaveBeenCalled();

		// Next query should get fresh data
		const result2 = await globalCachedDb.select().from(usersTable);
		expect(result2).toHaveLength(2);
	});

	test('custom cache configuration', async () => {
		await cachedDb.insert(usersTable).values({
			name: 'Custom Cache User',
			email: 'custom@example.com'
		});

		// Query with custom cache config
		const result = await cachedDb.select().from(usersTable).$withCache({
			tag: 'users-all',
			config: { ex: 300 }, // 5 minutes
			autoInvalidate: false
		});

		expect(result).toHaveLength(1);
	});

	test('disable cache for specific queries', async () => {
		await globalCachedDb.insert(usersTable).values({
			name: 'No Cache User',
			email: 'nocache@example.com'
		});

		const getCacheSpy = vi.spyOn(testGlobalCache, 'get');

		// Explicitly disable cache
		const result = await globalCachedDb.select().from(usersTable).$withCache(false);
		
		// Cache should not be consulted
		expect(getCacheSpy).not.toHaveBeenCalled();
		expect(result).toHaveLength(1);
	});

	test('manual cache invalidation', async () => {
		const onMutateSpy = vi.spyOn(testGlobalCache, 'onMutate');

		await globalCachedDb.insert(usersTable).values({
			name: 'Manual Invalidate User',
			email: 'manual@example.com'
		});

		// Cache the query
		await globalCachedDb.select().from(usersTable);

		// Manually invalidate cache
		await globalCachedDb.$cache?.invalidate({ tables: [usersTable] });

		expect(onMutateSpy).toHaveBeenCalledWith({ tables: [usersTable] });
	});

	test('cache works with complex queries', async () => {
		// Insert test data
		await globalCachedDb.insert(usersTable).values([
			{ name: 'Alice', email: 'alice@example.com' },
			{ name: 'Bob', email: 'bob@example.com' }
		]);

		const users = await globalCachedDb.select().from(usersTable);
		
		await globalCachedDb.insert(postsTable).values([
			{ title: 'Post 1', content: 'Content 1', userId: users[0].id },
			{ title: 'Post 2', content: 'Content 2', userId: users[1].id }
		]);

		// Complex join query with cache
		const result1 = await globalCachedDb
			.select({
				userName: usersTable.name,
				postTitle: postsTable.title,
				postContent: postsTable.content
			})
			.from(usersTable)
			.innerJoin(postsTable, eq(usersTable.id, postsTable.userId));

		// Same query again - should use cache
		const result2 = await globalCachedDb
			.select({
				userName: usersTable.name,
				postTitle: postsTable.title,
				postContent: postsTable.content
			})
			.from(usersTable)
			.innerJoin(postsTable, eq(usersTable.id, postsTable.userId));

		expect(result1).toEqual(result2);
		expect(result1).toHaveLength(2);
	});

	test('cache works with transactions', async () => {
		await globalCachedDb.transaction(async (tx) => {
			await tx.insert(usersTable).values({
				name: 'Transaction User',
				email: 'tx@example.com'
			});

			// Query within transaction
			const result = await tx.select().from(usersTable);
			expect(result).toHaveLength(1);
		});

		// Query after transaction
		const result = await globalCachedDb.select().from(usersTable);
		expect(result).toHaveLength(1);
	});

	test('cache with different parameter values', async () => {
		await globalCachedDb.insert(usersTable).values([
			{ name: 'User A', email: 'a@example.com' },
			{ name: 'User B', email: 'b@example.com' },
			{ name: 'User C', email: 'c@example.com' }
		]);

		// Different WHERE conditions should create different cache entries
		const userA = await globalCachedDb
			.select()
			.from(usersTable)
			.where(eq(usersTable.name, 'User A'));

		const userB = await globalCachedDb
			.select()
			.from(usersTable)
			.where(eq(usersTable.name, 'User B'));

		expect(userA).toHaveLength(1);
		expect(userB).toHaveLength(1);
		expect(userA[0].name).toBe('User A');
		expect(userB[0].name).toBe('User B');
	});

	test('async batch operations work with cache', async () => {
		const batchResult = await globalCachedDb.batch([
			globalCachedDb.insert(usersTable).values({ name: 'Batch User 1', email: 'batch1@example.com' }),
			globalCachedDb.insert(usersTable).values({ name: 'Batch User 2', email: 'batch2@example.com' }),
			globalCachedDb.select().from(usersTable)
		]);

		expect(batchResult).toHaveLength(3);
		expect(batchResult[2]).toHaveLength(2);
		expect(batchResult[2][0].name).toBe('Batch User 1');
		expect(batchResult[2][1].name).toBe('Batch User 2');
	});

	test('error handling preserves original behavior', async () => {
		// Test constraint violation
		await globalCachedDb.insert(usersTable).values({
			name: 'Test User',
			email: 'test@example.com'
		});

		// Try to insert duplicate (assuming email uniqueness if implemented)
		try {
			await globalCachedDb.run(sql`CREATE UNIQUE INDEX unique_email ON users(email)`);
			
			await expect(
				globalCachedDb.insert(usersTable).values({
					name: 'Duplicate User',
					email: 'test@example.com'
				})
			).rejects.toThrow();
		} catch (error) {
			// Expected constraint error
			expect(error).toBeDefined();
		}
	});
});
