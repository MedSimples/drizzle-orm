/// <reference types="@cloudflare/workers-types" />

import { eq, sql } from 'drizzle-orm';
import type { DrizzleSqliteDOCacheDatabase } from 'drizzle-orm/durable-sqlite-cache';
import { drizzle } from 'drizzle-orm/durable-sqlite-cache';
import { migrate } from 'drizzle-orm/durable-sqlite-cache/migrator';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { beforeAll, describe, expect, test } from 'vitest';
import { TestGlobalCache } from './sqlite-common-cache';
import { Storage } from './durable-objects-storage/miniflare';

// Real-world schema example
const usersTable = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	email: text('email').notNull(),
	role: text('role').notNull().default('user'),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
});

const sessionsTable = sqliteTable('sessions', {
	id: text('id').primaryKey(),
	userId: integer('user_id').notNull().references(() => usersTable.id),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
	data: text('data', { mode: 'json' }),
});

const postsTable = sqliteTable('posts', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	title: text('title').notNull(),
	content: text('content').notNull(),
	authorId: integer('author_id').notNull().references(() => usersTable.id),
	status: text('status').notNull().default('draft'),
	publishedAt: integer('published_at', { mode: 'timestamp' }),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
});

const schema = { 
	usersTable, 
	sessionsTable, 
	postsTable 
};

describe('Durable Objects + Cache Integration Tests', () => {
	let storage: DurableObjectStorage;
	let db: DrizzleSqliteDOCacheDatabase<typeof schema>;

	beforeAll(async () => {
		storage = await Storage();

		db = drizzle(storage, {
			schema,
			cache: new TestGlobalCache()
		});

		// Set up tables
		await db.run(sql`DROP TABLE IF EXISTS sessions`);
		await db.run(sql`DROP TABLE IF EXISTS posts`);
		await db.run(sql`DROP TABLE IF EXISTS users`);

		// Create tables in correct order due to foreign keys
		await db.run(sql`
			CREATE TABLE users (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				email TEXT NOT NULL UNIQUE,
				role TEXT NOT NULL DEFAULT 'user',
				created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
			)
		`);

		await db.run(sql`
			CREATE TABLE sessions (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				expires_at INTEGER NOT NULL,
				data TEXT
			)
		`);

		await db.run(sql`
			CREATE TABLE posts (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				title TEXT NOT NULL,
				content TEXT NOT NULL,
				author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				status TEXT NOT NULL DEFAULT 'draft',
				published_at INTEGER,
				created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
			)
		`);
	});

	test('user registration and authentication flow', async () => {
		// Register a new user
		const newUser = await db.insert(usersTable).values({
			name: 'Alice Johnson',
			email: 'alice@example.com',
			role: 'admin'
		}).returning();

		// Should not cache insert operations
		expect(newUser).toBeDefined();

		// Create a session for the user
		const sessionId = 'session_123';
		const sessionExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

		await db.insert(sessionsTable).values({
			id: sessionId,
			userId: 1, // First user gets ID 1
			expiresAt: sessionExpiry,
			data: { loginTime: new Date().toISOString(), ip: '127.0.0.1' }
		});

		// Verify user exists (should be cached)
		const user = await db.select()
			.from(usersTable)
			.where(eq(usersTable.email, 'alice@example.com'));

		expect(user).toHaveLength(1);
		expect(user[0].name).toBe('Alice Johnson');
		expect(user[0].role).toBe('admin');

		// Get session (should be cached)
		const session = await db.select()
			.from(sessionsTable)
			.where(eq(sessionsTable.id, sessionId));

		expect(session).toHaveLength(1);
		expect(session[0].userId).toBe(1);
		expect(session[0].data).toEqual({ 
			loginTime: expect.any(String), 
			ip: '127.0.0.1' 
		});
	});

	test('content management with caching', async () => {
		// Create multiple posts
		const posts = await db.insert(postsTable).values([
			{
				title: 'Getting Started with Drizzle',
				content: 'Drizzle is a great ORM...',
				authorId: 1,
				status: 'published',
				publishedAt: new Date()
			},
			{
				title: 'Advanced Caching Strategies',
				content: 'Caching can improve performance...',
				authorId: 1,
				status: 'draft'
			},
			{
				title: 'Durable Objects Best Practices',
				content: 'When working with Durable Objects...',
				authorId: 1,
				status: 'published',
				publishedAt: new Date()
			}
		]).returning();

		expect(posts).toHaveLength(3);

		// Get published posts (should be cached)
		const publishedPosts = await db.select({
			id: postsTable.id,
			title: postsTable.title,
			content: postsTable.content,
			authorName: usersTable.name
		})
			.from(postsTable)
			.innerJoin(usersTable, eq(postsTable.authorId, usersTable.id))
			.where(eq(postsTable.status, 'published'));

		expect(publishedPosts).toHaveLength(2);
		expect(publishedPosts[0].authorName).toBe('Alice Johnson');

		// Get the same query again - should use cache
		const cachedPublishedPosts = await db.select({
			id: postsTable.id,
			title: postsTable.title,
			content: postsTable.content,
			authorName: usersTable.name
		})
			.from(postsTable)
			.innerJoin(usersTable, eq(postsTable.authorId, usersTable.id))
			.where(eq(postsTable.status, 'published'));

		expect(cachedPublishedPosts).toEqual(publishedPosts);
	});

	test('cache invalidation on content updates', async () => {
		// First, get all posts to cache the query
		const allPosts = await db.select().from(postsTable);
		const initialCount = allPosts.length;

		// Publish a draft post (this should invalidate cache)
		await db.update(postsTable)
			.set({ 
				status: 'published',
				publishedAt: new Date()
			})
			.where(eq(postsTable.title, 'Advanced Caching Strategies'));

		// Query published posts again - should get fresh data
		const publishedPosts = await db.select()
			.from(postsTable)
			.where(eq(postsTable.status, 'published'));

		expect(publishedPosts).toHaveLength(3); // Now we have 3 published posts
		
		// Verify the specific post was updated
		const updatedPost = publishedPosts.find(p => p.title === 'Advanced Caching Strategies');
		expect(updatedPost).toBeDefined();
		expect(updatedPost?.status).toBe('published');
		expect(updatedPost?.publishedAt).toBeDefined();
	});

	test('complex queries with joins and aggregations', async () => {
		// Get author statistics with post counts
		const authorStats = await db.select({
			authorId: usersTable.id,
			authorName: usersTable.name,
			totalPosts: sql<number>`count(${postsTable.id})`,
			publishedPosts: sql<number>`count(case when ${postsTable.status} = 'published' then 1 end)`,
			draftPosts: sql<number>`count(case when ${postsTable.status} = 'draft' then 1 end)`
		})
			.from(usersTable)
			.leftJoin(postsTable, eq(usersTable.id, postsTable.authorId))
			.groupBy(usersTable.id, usersTable.name);

		expect(authorStats).toHaveLength(1);
		expect(authorStats[0].authorName).toBe('Alice Johnson');
		expect(authorStats[0].totalPosts).toBe(3);
		expect(authorStats[0].publishedPosts).toBe(3);
		expect(authorStats[0].draftPosts).toBe(0);
	});

	test('batch operations with cache implications', async () => {
		// Create a new user and multiple posts in a batch
		const batchResult = await db.batch([
			// Create user
			db.insert(usersTable).values({
				name: 'Bob Smith',
				email: 'bob@example.com',
				role: 'editor'
			}),
			
			// Get the user count before
			db.select({ count: sql<number>`count(*)` }).from(usersTable),
			
			// Create posts for the new user (assuming user ID 2)
			db.insert(postsTable).values([
				{
					title: 'Introduction to Bob',
					content: 'Hello, I am Bob',
					authorId: 2,
					status: 'published',
					publishedAt: new Date()
				},
				{
					title: 'Bob\'s Second Post',
					content: 'This is my second post',
					authorId: 2,
					status: 'draft'
				}
			]),

			// Get all users after
			db.select().from(usersTable)
		]);

		expect(batchResult).toHaveLength(4);
		
		// Check user count increased
		const userCount = batchResult[1][0].count;
		expect(userCount).toBe(2); // Was 1, now 2

		// Check users were created
		const allUsers = batchResult[3];
		expect(allUsers).toHaveLength(2);
		expect(allUsers.some(u => u.name === 'Bob Smith')).toBe(true);
	});

	test('session cleanup and cache consistency', async () => {
		// Create an expired session
		const expiredSessionId = 'expired_session';
		await db.insert(sessionsTable).values({
			id: expiredSessionId,
			userId: 1,
			expiresAt: new Date(Date.now() - 60000), // Expired 1 minute ago
			data: { test: 'expired' }
		});

		// Get all sessions first (to cache)
		const allSessions = await db.select().from(sessionsTable);
		expect(allSessions.length).toBeGreaterThanOrEqual(2);

		// Clean up expired sessions (should invalidate cache)
		const deletedCount = await db.delete(sessionsTable)
			.where(sql`${sessionsTable.expiresAt} < strftime('%s', 'now')`);

		// Verify cleanup worked and cache was invalidated
		const remainingSessions = await db.select().from(sessionsTable);
		expect(remainingSessions.length).toBeLessThan(allSessions.length);
		
		// Should not contain the expired session
		const hasExpiredSession = remainingSessions.some(s => s.id === expiredSessionId);
		expect(hasExpiredSession).toBe(false);
	});

	test('migration with cache-enabled database', async () => {
		// Test that migrations work with cached database
		const migrationConfig = {
			journal: {
				entries: [
					{
						idx: 0,
						when: Date.now(),
						tag: 'test_migration',
						breakpoints: false
					}
				]
			},
			migrations: {
				m0000: 'CREATE TABLE test_migration (id INTEGER PRIMARY KEY, data TEXT);'
			}
		};

		await migrate(db, migrationConfig);

		// Verify migration table exists
		const tables = await db.all(sql`
			SELECT name FROM sqlite_master 
			WHERE type='table' AND name IN ('__drizzle_migrations', 'test_migration')
		`);

		expect(tables.some((t: any) => t.name === '__drizzle_migrations')).toBe(true);
		expect(tables.some((t: any) => t.name === 'test_migration')).toBe(true);

		// Clean up
		await db.run(sql`DROP TABLE test_migration`);
		await db.run(sql`DROP TABLE __drizzle_migrations`);
	});

	test('error handling with cache enabled', async () => {
		// Test that database errors are properly handled even with cache
		
		// Try to insert duplicate email (should fail due to unique constraint)
		await expect(
			db.insert(usersTable).values({
				name: 'Duplicate Alice',
				email: 'alice@example.com' // Already exists
			})
		).rejects.toThrow();

		// Verify original data is intact
		const users = await db.select().from(usersTable);
		const aliceUsers = users.filter(u => u.email === 'alice@example.com');
		expect(aliceUsers).toHaveLength(1);
		expect(aliceUsers[0].name).toBe('Alice Johnson');
	});

	test('performance comparison: cached vs non-cached', async () => {
		// Create non-cached database instance for comparison
		const nonCachedDb = drizzle(storage, { schema });

		const query = () => db.select({
			id: usersTable.id,
			name: usersTable.name,
			postCount: sql<number>`count(${postsTable.id})`,
		})
			.from(usersTable)
			.leftJoin(postsTable, eq(usersTable.id, postsTable.authorId))
			.groupBy(usersTable.id);

		// Run the same query multiple times
		const cachedStart = performance.now();
		for (let i = 0; i < 5; i++) {
			await query();
		}
		const cachedTime = performance.now() - cachedStart;

		const nonCachedStart = performance.now();
		for (let i = 0; i < 5; i++) {
			await nonCachedDb.select({
				id: usersTable.id,
				name: usersTable.name,
				postCount: sql<number>`count(${postsTable.id})`,
			})
				.from(usersTable)
				.leftJoin(postsTable, eq(usersTable.id, postsTable.authorId))
				.groupBy(usersTable.id);
		}
		const nonCachedTime = performance.now() - nonCachedStart;

		// Note: This is more of a demonstration - actual cache benefits
		// would be more pronounced with real storage backends
		console.log(`Cached queries took: ${cachedTime}ms`);
		console.log(`Non-cached queries took: ${nonCachedTime}ms`);
		
		// Both should produce the same results
		const cachedResult = await query();
		const nonCachedResult = await nonCachedDb.select({
			id: usersTable.id,
			name: usersTable.name,
			postCount: sql<number>`count(${postsTable.id})`,
		})
			.from(usersTable)
			.leftJoin(postsTable, eq(usersTable.id, postsTable.authorId))
			.groupBy(usersTable.id);

		expect(cachedResult).toEqual(nonCachedResult);
	});
});
