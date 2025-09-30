/// <reference types="@cloudflare/workers-types" />

import { sql } from 'drizzle-orm';
import type { DrizzleSqliteDOCacheDatabase } from 'drizzle-orm/durable-sqlite-cache';
import { drizzle } from 'drizzle-orm/durable-sqlite-cache';
import { migrate } from 'drizzle-orm/durable-sqlite-cache/migrator';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { skipTests } from '~/common';
import { randomString } from '~/utils';
import { anotherUsersMigratorTable, tests, usersMigratorTable } from './sqlite-common';
import { TestCache, TestGlobalCache, tests as cacheTests } from './sqlite-common-cache';
import { Storage } from './durable-objects-storage/miniflare';

const ENABLE_LOGGING = false;

declare module 'vitest' {
	interface TestContext {
		sqlite: {
			db: DrizzleSqliteDOCacheDatabase;
		};
		cachedSqlite: {
			db: DrizzleSqliteDOCacheDatabase;
			dbGlobalCached: DrizzleSqliteDOCacheDatabase;
		};
	}
}

let db: DrizzleSqliteDOCacheDatabase;
let dbGlobalCached: DrizzleSqliteDOCacheDatabase;
let cachedDb: DrizzleSqliteDOCacheDatabase;
let storage: DurableObjectStorage;

beforeAll(async () => {
	storage = await Storage();
	
	db = drizzle(storage, { logger: ENABLE_LOGGING });
	cachedDb = drizzle(storage, { logger: ENABLE_LOGGING, cache: new TestCache() });
	dbGlobalCached = drizzle(storage, { logger: ENABLE_LOGGING, cache: new TestGlobalCache() });
});

beforeEach((ctx) => {
	ctx.sqlite = {
		db,
	};
	ctx.cachedSqlite = {
		db: cachedDb,
		dbGlobalCached,
	};
});

test('migrator', async () => {
	await db.run(sql`drop table if exists another_users`);
	await db.run(sql`drop table if exists users12`);
	await db.run(sql`drop table if exists __drizzle_migrations`);

	await migrate(db, { 
		journal: { entries: [] },
		migrations: {}
	});

	await db.insert(usersMigratorTable).values({ name: 'John', email: 'email' });
	const result = await db.select().from(usersMigratorTable);

	await db.insert(anotherUsersMigratorTable).values({ name: 'John', email: 'email' });
	const result2 = await db.select().from(anotherUsersMigratorTable);

	expect(result).toEqual([{ id: 1, name: 'John', email: 'email' }]);
	expect(result2).toEqual([{ id: 1, name: 'John', email: 'email' }]);

	await db.run(sql`drop table another_users`);
	await db.run(sql`drop table users12`);
	await db.run(sql`drop table __drizzle_migrations`);
});

test('basic async operations', async () => {
	const testTableName = `test_basic_${randomString()}`;
	
	await db.run(sql.raw(`CREATE TABLE ${testTableName} (id INTEGER PRIMARY KEY, name TEXT)`));
	
	await db.run(sql.raw(`INSERT INTO ${testTableName} (name) VALUES ('test')`));
	
	const result = await db.all(sql.raw(`SELECT * FROM ${testTableName}`));
	expect(result).toHaveLength(1);
	expect(result[0]).toEqual({ id: 1, name: 'test' });
	
	const single = await db.get(sql.raw(`SELECT * FROM ${testTableName} WHERE id = 1`));
	expect(single).toEqual({ id: 1, name: 'test' });
	
	await db.run(sql.raw(`DROP TABLE ${testTableName}`));
});

test('transactions work async', async () => {
	const testTableName = `test_transaction_${randomString()}`;
	
	await db.run(sql.raw(`CREATE TABLE ${testTableName} (id INTEGER PRIMARY KEY, name TEXT)`));
	
	await db.transaction(async (tx) => {
		await tx.run(sql.raw(`INSERT INTO ${testTableName} (name) VALUES ('tx1')`));
		await tx.run(sql.raw(`INSERT INTO ${testTableName} (name) VALUES ('tx2')`));
	});
	
	const result = await db.all(sql.raw(`SELECT * FROM ${testTableName}`));
	expect(result).toHaveLength(2);
	
	await db.run(sql.raw(`DROP TABLE ${testTableName}`));
});

test('transaction rollback works', async () => {
	const testTableName = `test_rollback_${randomString()}`;
	
	await db.run(sql.raw(`CREATE TABLE ${testTableName} (id INTEGER PRIMARY KEY, name TEXT)`));
	await db.run(sql.raw(`INSERT INTO ${testTableName} (name) VALUES ('before')`));
	
	try {
		await db.transaction(async (tx) => {
			await tx.run(sql.raw(`INSERT INTO ${testTableName} (name) VALUES ('during')`));
			throw new Error('rollback test');
		});
	} catch (error) {
		expect((error as Error).message).toBe('rollback test');
	}
	
	const result = await db.all(sql.raw(`SELECT * FROM ${testTableName}`));
	expect(result).toHaveLength(1);
	expect(result[0]).toEqual({ id: 1, name: 'before' });
	
	await db.run(sql.raw(`DROP TABLE ${testTableName}`));
});

test('cache functionality', async () => {
	const testTableName = `test_cache_${randomString()}`;
	
	// Test with cached database
	await cachedDb.run(sql.raw(`CREATE TABLE ${testTableName} (id INTEGER PRIMARY KEY, name TEXT)`));
	await cachedDb.run(sql.raw(`INSERT INTO ${testTableName} (name) VALUES ('cached')`));
	
	// First query - should cache
	const result1 = await cachedDb.all(sql.raw(`SELECT * FROM ${testTableName}`));
	expect(result1).toHaveLength(1);
	
	// Second query - should use cache
	const result2 = await cachedDb.all(sql.raw(`SELECT * FROM ${testTableName}`));
	expect(result2).toHaveLength(1);
	
	await cachedDb.run(sql.raw(`DROP TABLE ${testTableName}`));
});

test('global cache functionality', async () => {
	const testTableName = `test_global_cache_${randomString()}`;
	
	await dbGlobalCached.run(sql.raw(`CREATE TABLE ${testTableName} (id INTEGER PRIMARY KEY, name TEXT)`));
	await dbGlobalCached.run(sql.raw(`INSERT INTO ${testTableName} (name) VALUES ('global_cached')`));
	
	// With global cache, queries are cached automatically
	const result1 = await dbGlobalCached.all(sql.raw(`SELECT * FROM ${testTableName}`));
	expect(result1).toHaveLength(1);
	
	const result2 = await dbGlobalCached.all(sql.raw(`SELECT * FROM ${testTableName}`));
	expect(result2).toHaveLength(1);
	
	await dbGlobalCached.run(sql.raw(`DROP TABLE ${testTableName}`));
});

test('cache invalidation on mutations', async () => {
	const testTableName = `test_invalidation_${randomString()}`;
	
	await dbGlobalCached.run(sql.raw(`CREATE TABLE ${testTableName} (id INTEGER PRIMARY KEY, name TEXT)`));
	await dbGlobalCached.run(sql.raw(`INSERT INTO ${testTableName} (name) VALUES ('original')`));
	
	// Cache the select query
	const result1 = await dbGlobalCached.all(sql.raw(`SELECT * FROM ${testTableName}`));
	expect(result1).toHaveLength(1);
	
	// Insert should invalidate cache
	await dbGlobalCached.run(sql.raw(`INSERT INTO ${testTableName} (name) VALUES ('new')`));
	
	// Should get fresh data
	const result2 = await dbGlobalCached.all(sql.raw(`SELECT * FROM ${testTableName}`));
	expect(result2).toHaveLength(2);
	
	await dbGlobalCached.run(sql.raw(`DROP TABLE ${testTableName}`));
});

if (!skipTests) {
	tests();
	cacheTests();
}
