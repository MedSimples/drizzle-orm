import { randomUUID } from 'crypto';
import { LibSQLDatabase } from 'drizzle-orm/libsql';
import {
	columnsResolver,
	sqliteViewsResolver,
	tablesResolver
} from './cli/commands/migrate';
import { sqlitePushIntrospect } from './cli/commands/sqliteIntrospect';
import { logSuggestionsAndReturn } from './cli/commands/sqlitePushUtils';
import type { CasingType } from './cli/validations/common';
import { originUUID } from './global';
import { MySqlSchema as MySQLSchemaKit } from './serializer/mysqlSchema';
import { PgSchema as PgSchemaKit } from './serializer/pgSchema';
import {
	SingleStoreSchema as SingleStoreSchemaKit
} from './serializer/singlestoreSchema';
import { SQLiteSchema as SQLiteSchemaKit, sqliteSchema, squashSqliteScheme } from './serializer/sqliteSchema';
import { generateSqliteSnapshot } from './serializer/sqliteSerializer';
import { debug, type SQLiteDB } from './utils';
import { prepareFromExports } from './serializer/sqliteImports';
import { applySqliteSnapshotsDiff } from './snapshotsDiffer';
import { sql } from 'drizzle-orm';

export type DrizzleSnapshotJSON = PgSchemaKit;
export type DrizzleSQLiteSnapshotJSON = SQLiteSchemaKit;
export type DrizzleMySQLSnapshotJSON = MySQLSchemaKit;
export type DrizzleSingleStoreSnapshotJSON = SingleStoreSchemaKit;

// SQLite

export const generateSQLiteDrizzleJson = async (
	imports: Record<string, unknown>,
	prevId?: string,
	casing?: CasingType,
): Promise<SQLiteSchemaKit> => {

	const prepared = prepareFromExports(imports);

	const id = randomUUID();

	const snapshot = generateSqliteSnapshot(prepared.tables, prepared.views, casing);

	return {
		...snapshot,
		id,
		prevId: prevId ?? originUUID,
	};
};

export const generateSQLiteMigration = async (
	prev: DrizzleSQLiteSnapshotJSON,
	cur: DrizzleSQLiteSnapshotJSON,
) => {

	const validatedPrev = sqliteSchema.parse(prev);
	const validatedCur = sqliteSchema.parse(cur);

	const squashedPrev = squashSqliteScheme(validatedPrev);
	const squashedCur = squashSqliteScheme(validatedCur);

	const { sqlStatements } = await applySqliteSnapshotsDiff(
		squashedPrev,
		squashedCur,
		tablesResolver,
		columnsResolver,
		sqliteViewsResolver,
		validatedCur,
	);

	return sqlStatements;
};

export const pushSchema = async (
	imports: Record<string, unknown>,
	drizzleInstance: LibSQLDatabase<any>,
	tablesFilter?: string[],
) => {
	debug('::pushSchema()', {
		imports,
		tablesFilter,
	});
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

	const cur = await generateSQLiteDrizzleJson(({...imports}));
	const { schema: prev } = await sqlitePushIntrospect(db, tablesFilter ?? []);

	const validatedPrev = sqliteSchema.parse(prev);
	const validatedCur = sqliteSchema.parse(cur);

	const squashedPrev = squashSqliteScheme(validatedPrev, 'push');
	const squashedCur = squashSqliteScheme(validatedCur, 'push');

	const { statements, sqlStatements, _meta } = await applySqliteSnapshotsDiff(
		squashedPrev,
		squashedCur,
		tablesResolver,
		columnsResolver,
		sqliteViewsResolver,
		validatedCur,
		'push',
	);

	const resolvedSuggestions = await logSuggestionsAndReturn(
		db,
		statements,
		squashedPrev,
		squashedCur,
		_meta!,
	);

	return {

		snapshot: {
			statements, 
			sqlStatements, 
			_meta,
		},
		
		squashed: {
			prev: squashedPrev,
			cur: squashedCur,
		},

		...resolvedSuggestions,
		apply: async () => {
			for (const dStmnt of resolvedSuggestions.statementsToExecute) {
				await db.query(dStmnt);
			}
		},
	};
};
