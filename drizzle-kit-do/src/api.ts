import { randomUUID } from 'crypto';
import { is, sql } from 'drizzle-orm';
import { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import { AnySQLiteTable, SQLiteTable, SQLiteView } from 'drizzle-orm/sqlite-core';
import { originUUID } from './global';
import {
	columnsResolver,
	sqliteViewsResolver,
	tablesResolver
} from './resolvers';
import { SQLiteSchema as SQLiteSchemaKit, sqliteSchema, squashSqliteScheme } from './serializer/sqliteSchema';
import { generateSqliteSnapshot } from './serializer/sqliteSerializer';
import { simplifiedSqlitePushIntrospect } from './simplified-push';
import { applySqliteSnapshotsDiff } from './snapshotsDiffer';
import type { SQLiteDB } from './utils';
import { logSuggestionsAndReturn } from './cli/commands/sqlitePushUtils';

export type DrizzleSQLiteSnapshotJSON = SQLiteSchemaKit;

// Inline implementation to avoid dependencies
const prepareFromExports = (exports: Record<string, unknown>) => {
	const tables: AnySQLiteTable[] = [];
	const views: SQLiteView[] = [];

	const i0values = Object.values(exports);
	for (const t of i0values) {
		if (is(t, SQLiteTable)) {
			tables.push(t);
		}

		if (is(t, SQLiteView)) {
			views.push(t);
		}
	}

	return { tables, views };
};

export const pushSchema = async (
	imports: Record<string, unknown>,
	drizzleInstance: DrizzleSqliteDODatabase<any>,
	tablesFilter?: string[],
): Promise<{ statements: any[]; statementsToExecute: string[] }> => {
	const db: SQLiteDB = {
		query: async (query: string, params?: any[]) => {
			const res = drizzleInstance.all<any>(sql.raw(query));
			return res;
		},
		run: async (query: string) => {
			return Promise.resolve(drizzleInstance.run(sql.raw(query))).then(
				() => {},
			);
		},
	};

	const { tables, views } = prepareFromExports(imports);
	const cur = generateSqliteSnapshot(tables, views, undefined);
	const validatedCur = sqliteSchema.safeParse({
		id: randomUUID(),
		prevId: imports.prevId ?? originUUID,
		...cur,
	});
	if (!validatedCur.success) {
		throw new Error(`Invalid current schema: ${JSON.stringify(validatedCur.error.issues)}`);
	}

	const { schema: prev } = await simplifiedSqlitePushIntrospect(db, tablesFilter ?? []);
	const validatedPrev = sqliteSchema.safeParse(prev);
	if (!validatedPrev.success) {
		throw new Error(`Invalid previous schema: ${JSON.stringify(validatedPrev.error.issues)}`);
	}

	const squashedPrev = squashSqliteScheme(validatedPrev.data, 'push');
	const squashedCur = squashSqliteScheme(validatedCur.data, 'push');

	const { statements, _meta } = await applySqliteSnapshotsDiff(
		squashedPrev,
		squashedCur,
		tablesResolver,
		columnsResolver,
		sqliteViewsResolver as any,
		validatedCur.data,
		'push',
	);

	const { statementsToExecute } = await logSuggestionsAndReturn(
		db,
		statements,
		squashedPrev,
		squashedCur,
		_meta!,
	);

	return {
		statements,
		statementsToExecute,
	};
};
