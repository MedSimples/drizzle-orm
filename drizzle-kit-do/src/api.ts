import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import {
	columnsResolver,
	sqliteViewsResolver,
	tablesResolver
} from './cli/commands/migrate';
import { sqlitePushIntrospect } from './cli/commands/sqliteIntrospect';
import type { CasingType } from './cli/validations/common';
import { originUUID } from './global';
import { prepareFromExports } from './serializer/sqliteImports';
import { SQLiteSchema as SQLiteSchemaKit, sqliteSchema, squashSqliteScheme } from './serializer/sqliteSchema';
import { generateSqliteSnapshot } from './serializer/sqliteSerializer';
import { applySqliteSnapshotsDiff } from './snapshotsDiffer';
import type { SQLiteDB } from './utils';
import { logSuggestionsAndReturn } from './cli/commands/sqlitePushUtils';

export type DrizzleSQLiteSnapshotJSON = SQLiteSchemaKit;

// SQLite

export const generateDrizzleJson = async (
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

export const generateMigration = async (
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
		validatedPrev,
		validatedCur,
	);

	return sqlStatements;
};

export const pushSchema = async (
	imports: Record<string, unknown>,
	drizzleInstance: DrizzleSqliteDODatabase<any>,
	tablesFilter?: string[],
): Promise<string[]> => {
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

	const cur = await generateDrizzleJson(imports);
	const { schema: prev } = await sqlitePushIntrospect(db, tablesFilter ?? []);

	const validatedPrev = sqliteSchema.parse(prev);
	const validatedCur = sqliteSchema.parse(cur);

	const squashedPrev = squashSqliteScheme(validatedPrev, 'push');
	const squashedCur = squashSqliteScheme(validatedCur, 'push');
	
	// return await applySqliteSnapshotsDiff(
	// 	squashedPrev,
	// 	squashedCur,
	// 	tablesResolver,
	// 	columnsResolver,
	// 	sqliteViewsResolver,
	// 	validatedPrev,
	// 	validatedCur,
	// 	'push',
	// );

	const { statements, _meta } = await applySqliteSnapshotsDiff(
		squashedPrev,
		squashedCur,
		tablesResolver,
		columnsResolver,
		sqliteViewsResolver,
		validatedPrev,
		validatedCur,
		'push',
	);

	const { statementsToExecute } = await logSuggestionsAndReturn(
		db,
		statements,
		squashedPrev,
		squashedCur,
		_meta!,
	);

	return statementsToExecute;

	// return {
	// 	hasDataLoss: shouldAskForApprove,
	// 	warnings: infoToPrint,
	// 	statementsToExecute,
	// 	apply: async () => {
	// 		for (const dStmnt of statementsToExecute) {
	// 			await db.query(dStmnt);
	// 		}
	// 	},
	// };
};
