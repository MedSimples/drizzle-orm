/// <reference types="@cloudflare/workers-types" />

import { eq, relations, sql } from 'drizzle-orm';
import type { DrizzleSqliteDOCacheDatabase } from 'drizzle-orm/durable-sqlite-cache';
import { drizzle } from 'drizzle-orm/durable-sqlite-cache';
import { type AnySQLiteColumn, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { afterAll, beforeAll, beforeEach, expect, expectTypeOf, test } from 'vitest';
import { Storage } from './durable-objects-storage/miniflare';

const ENABLE_LOGGING = false;

export const usersTable = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	verified: integer('verified').notNull().default(0),
	invitedBy: integer('invited_by').references((): AnySQLiteColumn => usersTable.id),
});

export const usersConfig = relations(usersTable, ({ one, many }) => ({
	invitee: one(usersTable, {
		fields: [usersTable.invitedBy],
		references: [usersTable.id],
	}),
	usersToGroups: many(usersToGroupsTable),
	posts: many(postsTable),
}));

export const groupsTable = sqliteTable('groups', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	description: text('description'),
});

export const groupsConfig = relations(groupsTable, ({ many }) => ({
	usersToGroups: many(usersToGroupsTable),
}));

export const usersToGroupsTable = sqliteTable(
	'users_to_groups',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id', { mode: 'number' }).notNull().references(
			() => usersTable.id,
		),
		groupId: integer('group_id', { mode: 'number' }).notNull().references(
			() => groupsTable.id,
		),
	},
	(t) => ({
		pk: primaryKey({ columns: [t.userId, t.groupId] }),
	}),
);

export const usersToGroupsConfig = relations(usersToGroupsTable, ({ one }) => ({
	group: one(groupsTable, {
		fields: [usersToGroupsTable.groupId],
		references: [groupsTable.id],
	}),
	user: one(usersTable, {
		fields: [usersToGroupsTable.userId],
		references: [usersTable.id],
	}),
}));

export const postsTable = sqliteTable('posts', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	content: text('content').notNull(),
	ownerId: integer('owner_id').references(() => usersTable.id),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
});

export const postsConfig = relations(postsTable, ({ one, many }) => ({
	author: one(usersTable, {
		fields: [postsTable.ownerId],
		references: [usersTable.id],
	}),
	comments: many(commentsTable),
}));

export const commentsTable = sqliteTable('comments', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	content: text('content').notNull(),
	creator: integer('creator').references(() => usersTable.id),
	postId: integer('post_id').references(() => postsTable.id),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
});

export const commentsConfig = relations(commentsTable, ({ one }) => ({
	post: one(postsTable, {
		fields: [commentsTable.postId],
		references: [postsTable.id],
	}),
	author: one(usersTable, {
		fields: [commentsTable.creator],
		references: [usersTable.id],
	}),
}));

const schema = {
	usersTable,
	postsTable,
	commentsTable,
	usersToGroupsTable,
	groupsTable,
	usersConfig,
	postsConfig,
	commentsConfig,
	usersToGroupsConfig,
	groupsConfig,
};

let db: DrizzleSqliteDOCacheDatabase<typeof schema>;
let storage: DurableObjectStorage;

beforeAll(async () => {
	storage = await Storage();
	
	db = drizzle(storage, { 
		logger: ENABLE_LOGGING,
		schema
	});
});

beforeEach(async () => {
	await db.run(sql`DROP TABLE IF EXISTS users`);
	await db.run(sql`DROP TABLE IF EXISTS groups`);  
	await db.run(sql`DROP TABLE IF EXISTS users_to_groups`);
	await db.run(sql`DROP TABLE IF EXISTS posts`);
	await db.run(sql`DROP TABLE IF EXISTS comments`);

	// Create tables in proper order (due to foreign keys)
	await db.run(sql`
		CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			verified INTEGER NOT NULL DEFAULT 0,
			invited_by INTEGER REFERENCES users(id)
		)
	`);

	await db.run(sql`
		CREATE TABLE groups (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			description TEXT
		)
	`);

	await db.run(sql`
		CREATE TABLE users_to_groups (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id),
			group_id INTEGER NOT NULL REFERENCES groups(id)
		)
	`);

	await db.run(sql`
		CREATE TABLE posts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			content TEXT NOT NULL,
			owner_id INTEGER REFERENCES users(id),
			created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
		)
	`);

	await db.run(sql`
		CREATE TABLE comments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			content TEXT NOT NULL,
			creator INTEGER REFERENCES users(id),
			post_id INTEGER REFERENCES posts(id),
			created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
		)
	`);
});

afterAll(async () => {
	await db.run(sql`DROP TABLE IF EXISTS users`);
	await db.run(sql`DROP TABLE IF EXISTS groups`);
	await db.run(sql`DROP TABLE IF EXISTS users_to_groups`);
	await db.run(sql`DROP TABLE IF EXISTS posts`);
	await db.run(sql`DROP TABLE IF EXISTS comments`);
});

test('insert + select', async () => {
	const result = await db.insert(usersTable).values([
		{ name: 'John' },
		{ name: 'Jane' },
		{ name: 'Jack' },
		{ name: 'Jill' },
	]);

	expectTypeOf(result).toEqualTypeOf<void>();

	const users = await db.select().from(usersTable);

	expectTypeOf(users).toEqualTypeOf<{
		id: number;
		name: string;
		verified: number;
		invitedBy: number | null;
	}[]>();

	expect(users.length).eq(4);
	expect(users[0]?.name).eq('John');
	expect(users[1]?.name).eq('Jane');
	expect(users[2]?.name).eq('Jack');
	expect(users[3]?.name).eq('Jill');
});

test('async batch insert + select', async () => {
	const batchResponse = await db.batch([
		db.insert(usersTable).values({ name: 'John' }),
		db.insert(usersTable).values({ name: 'Jane' }),
		db.insert(usersTable).values({ name: 'Jack' }),
		db.insert(usersTable).values({ name: 'Jill' }),
		db.select().from(usersTable),
	]);

	expectTypeOf(batchResponse).toEqualTypeOf<[void, void, void, void, {
		id: number;
		name: string;
		verified: number;
		invitedBy: number | null;
	}[]]>();

	expect(batchResponse.length).eq(5);

	const users = batchResponse[4];
	expect(users.length).eq(4);
	expect(users[0]?.name).eq('John');
	expect(users[1]?.name).eq('Jane');
	expect(users[2]?.name).eq('Jack');
	expect(users[3]?.name).eq('Jill');
});

test('async batch with transactions', async () => {
	const result = await db.transaction(async (tx) => {
		const batchResponse = await tx.batch([
			tx.insert(usersTable).values({ name: 'John' }),
			tx.insert(usersTable).values({ name: 'Jane' }),
			tx.select().from(usersTable),
		]);

		return batchResponse;
	});

	expect(result.length).eq(3);
	const users = result[2];
	expect(users.length).eq(2);
	expect(users[0]?.name).eq('John');
	expect(users[1]?.name).eq('Jane');
});

test('async batch with rollback', async () => {
	await db.insert(usersTable).values({ name: 'Pre-existing' });

	try {
		await db.transaction(async (tx) => {
			await tx.batch([
				tx.insert(usersTable).values({ name: 'John' }),
				tx.insert(usersTable).values({ name: 'Jane' }),
			]);
			
			throw new Error('Rollback test');
		});
	} catch (error) {
		expect((error as Error).message).eq('Rollback test');
	}

	const users = await db.select().from(usersTable);
	expect(users.length).eq(1);
	expect(users[0]?.name).eq('Pre-existing');
});

test('async batch with cache', async () => {
	const cachedDb = drizzle(storage, { 
		logger: ENABLE_LOGGING,
		schema,
		cache: {
			strategy: () => 'all',
			async get() { return undefined; },
			async put() {},
			async onMutate() {},
		}
	});

	// First batch - should cache the select
	const batchResponse1 = await cachedDb.batch([
		cachedDb.insert(usersTable).values({ name: 'John' }),
		cachedDb.select().from(usersTable),
	]);

	expect(batchResponse1.length).eq(2);
	expect(batchResponse1[1].length).eq(1);

	// Second batch - select should use cache
	const batchResponse2 = await cachedDb.batch([
		cachedDb.select().from(usersTable),
	]);

	expect(batchResponse2[0].length).eq(1);
});

test('update returning async batch', async () => {
	await db.insert(usersTable).values([
		{ name: 'John' },
		{ name: 'Jane' },
	]);

	const batchResponse = await db.batch([
		db.update(usersTable).set({ name: 'Johnny' }).where(eq(usersTable.id, 1)),
		db.update(usersTable).set({ name: 'Janny' }).where(eq(usersTable.id, 2)),
		db.select().from(usersTable),
	]);

	expect(batchResponse.length).eq(3);
	const users = batchResponse[2];
	expect(users.length).eq(2);
	expect(users[0]?.name).eq('Johnny');
	expect(users[1]?.name).eq('Janny');
});

test('delete returning async batch', async () => {
	await db.insert(usersTable).values([
		{ name: 'John' },
		{ name: 'Jane' },
		{ name: 'Jack' },
	]);

	const batchResponse = await db.batch([
		db.delete(usersTable).where(eq(usersTable.id, 1)),
		db.delete(usersTable).where(eq(usersTable.id, 3)),
		db.select().from(usersTable),
	]);

	expect(batchResponse.length).eq(3);
	const users = batchResponse[2];
	expect(users.length).eq(1);
	expect(users[0]?.name).eq('Jane');
});

test('complex async batch operations', async () => {
	const complexBatch = await db.batch([
		db.insert(usersTable).values({ name: 'Author' }),
		db.insert(usersTable).values({ name: 'Reader' }),
		db.select().from(usersTable),
		db.insert(postsTable).values({ content: 'Hello World', ownerId: 1 }),
		db.insert(postsTable).values({ content: 'Second Post', ownerId: 1 }),
		db.select({
			postId: postsTable.id,
			content: postsTable.content,
			authorName: usersTable.name,
		})
			.from(postsTable)
			.innerJoin(usersTable, eq(postsTable.ownerId, usersTable.id)),
	]);

	expect(complexBatch.length).eq(6);
	
	const users = complexBatch[2];
	expect(users.length).eq(2);
	
	const posts = complexBatch[5];
	expect(posts.length).eq(2);
	expect(posts[0]?.content).eq('Hello World');
	expect(posts[0]?.authorName).eq('Author');
	expect(posts[1]?.content).eq('Second Post');
	expect(posts[1]?.authorName).eq('Author');
});
