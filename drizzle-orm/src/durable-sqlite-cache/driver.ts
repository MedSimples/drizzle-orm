/// <reference types="@cloudflare/workers-types" />
import type { BatchItem, BatchResponse } from '~/batch.ts';
import { entityKind } from '~/entity.ts';
import { DefaultLogger } from '~/logger.ts';
import {
	createTableRelationsHelpers,
	extractTablesRelationalConfig,
	type ExtractTablesWithRelations,
	type RelationalSchemaConfig,
	type TablesRelationalConfig,
} from '~/relations.ts';
import { BaseSQLiteDatabase } from '~/sqlite-core/db.ts';
import { SQLiteAsyncDialect } from '~/sqlite-core/dialect.ts';
import type { DrizzleConfig } from '~/utils.ts';
import { SQLiteDOCacheSession } from './session.ts';

export class DrizzleSqliteDOCacheDatabase<
	TSchema extends Record<string, unknown> = Record<string, never>,
> extends BaseSQLiteDatabase<'async', SqlStorageCursor<Record<string, SqlStorageValue>>, TSchema> {
	static override readonly [entityKind]: string = 'DrizzleSqliteDOCacheDatabase';

	/** @internal */
	// @ts-expect-error - DurableObjectTransaction is not a SQLiteTransaction
	declare readonly session: SQLiteDOCacheSession<TSchema, ExtractTablesWithRelations<TSchema>>;

	async batch<U extends BatchItem<'sqlite'>, T extends Readonly<[U, ...U[]]>>(
		batch: T,
	): Promise<BatchResponse<T>> {
		return this.session.batch(batch) as Promise<BatchResponse<T>>;
	}
}

export function drizzle<
	TSchema extends Record<string, unknown> = Record<string, never>,
	TClient extends DurableObjectStorage = DurableObjectStorage,
>(
	client: TClient,
	config: DrizzleConfig<TSchema> = {},
): DrizzleSqliteDOCacheDatabase<TSchema> & {
	$client: TClient;
} {
	const dialect = new SQLiteAsyncDialect({ casing: config.casing });
	let logger;
	if (config.logger === true) {
		logger = new DefaultLogger();
	} else if (config.logger !== false) {
		logger = config.logger;
	}

	let schema: RelationalSchemaConfig<TablesRelationalConfig> | undefined;
	if (config.schema) {
		const tablesConfig = extractTablesRelationalConfig(
			config.schema,
			createTableRelationsHelpers,
		);
		schema = {
			fullSchema: config.schema,
			schema: tablesConfig.tables,
			tableNamesMap: tablesConfig.tableNamesMap,
		};
	}

	const session = new SQLiteDOCacheSession(client as DurableObjectStorage, dialect, schema, { logger, cache: config.cache });
	// @ts-expect-error - DurableObjectTransaction is not a SQLiteTransaction
	const db = new DrizzleSqliteDOCacheDatabase('async', dialect, session, schema) as DrizzleSqliteDOCacheDatabase<TSchema>;
	(<any> db).$client = client;
	(<any> db).$cache = config.cache;
	if ((<any> db).$cache) {
		(<any> db).$cache['invalidate'] = config.cache?.onMutate;
	}

	return db as any;
}

