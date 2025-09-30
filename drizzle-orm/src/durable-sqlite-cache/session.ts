/// <reference types="@cloudflare/workers-types" />

import type { BatchItem } from '~/batch.ts';
import { type Cache, NoopCache } from '~/cache/core/index.ts';
import type { WithCacheConfig } from '~/cache/core/types.ts';
import { entityKind } from '~/entity.ts';
import type { Logger } from '~/logger.ts';
import { NoopLogger } from '~/logger.ts';
import type { RelationalSchemaConfig, TablesRelationalConfig } from '~/relations.ts';
import type { PreparedQuery } from '~/session.ts';
import { fillPlaceholders, type Query, sql } from '~/sql/sql.ts';
import { type SQLiteAsyncDialect, SQLiteTransaction } from '~/sqlite-core/index.ts';
import type { SelectedFieldsOrdered } from '~/sqlite-core/query-builders/select.types.ts';
import {
	type PreparedQueryConfig as PreparedQueryConfigBase,
	type SQLiteExecuteMethod,
	SQLiteSession,
	type SQLiteTransactionConfig,
} from '~/sqlite-core/session.ts';
import { SQLitePreparedQuery as PreparedQueryBase } from '~/sqlite-core/session.ts';
import { mapResultRow } from '~/utils.ts';

export interface SQLiteDOCacheSessionOptions {
	logger?: Logger;
	cache?: Cache;
}

type PreparedQueryConfig = Omit<PreparedQueryConfigBase, 'statement' | 'run'>;

export class SQLiteDOCacheSession<TFullSchema extends Record<string, unknown>, TSchema extends TablesRelationalConfig>
	extends SQLiteSession<
		'async',
		SqlStorageCursor<Record<string, SqlStorageValue>>,
		TFullSchema,
		TSchema
	>
{
	static override readonly [entityKind]: string = 'SQLiteDOCacheSession';

	private logger: Logger;
	private cache: Cache;

	constructor(
		private client: DurableObjectStorage,
		dialect: SQLiteAsyncDialect,
		private schema: RelationalSchemaConfig<TSchema> | undefined,
		options: SQLiteDOCacheSessionOptions = {},
	) {
		super(dialect);
		this.logger = options.logger ?? new NoopLogger();
		this.cache = options.cache ?? new NoopCache();
	}

	prepareQuery<T extends Omit<PreparedQueryConfig, 'run'>>(
		query: Query,
		fields: SelectedFieldsOrdered | undefined,
		executeMethod: SQLiteExecuteMethod,
		isResponseInArrayMode: boolean,
		customResultMapper?: (rows: unknown[][]) => unknown,
		queryMetadata?: {
			type: 'select' | 'update' | 'delete' | 'insert';
			tables: string[];
		},
		cacheConfig?: WithCacheConfig,
	): SQLiteDOCachePreparedQuery<T> {
		return new SQLiteDOCachePreparedQuery(
			this.client,
			query,
			this.logger,
			this.cache,
			queryMetadata,
			cacheConfig,
			fields,
			executeMethod,
			isResponseInArrayMode,
			customResultMapper,
		);
	}

	// @ts-expect-error - DurableObjectTransaction is not a SQLiteTransaction
	override async transaction<T>(
		transaction: (
			tx: DurableObjectTransaction,
		) => Promise<T>,
		config?: SQLiteTransactionConfig,
	): Promise<T> {
		return await this.client.transaction(transaction);
	}

	async batch<T extends BatchItem<'sqlite'>[] | readonly BatchItem<'sqlite'>[]>(queries: T) {
		const preparedQueries: PreparedQuery[] = [];
		const results: unknown[] = [];

		// Execute each query individually since DurableObjectStorage doesn't have native batch support
		for (const query of queries) {
			const preparedQuery = query._prepare();
			preparedQueries.push(preparedQuery);
			
			// Execute the prepared query and get its result
			const result = await (preparedQuery as any).execute();
			results.push(result);
		}

		return results.map((result, i) => preparedQueries[i]!.mapResult(result, false));
	}
}

export class SQLiteDOCacheTransaction<TFullSchema extends Record<string, unknown>, TSchema extends TablesRelationalConfig>
	extends SQLiteTransaction<
		'async',
		SqlStorageCursor<Record<string, SqlStorageValue>>,
		TFullSchema,
		TSchema
	>
{
	static override readonly [entityKind]: string = 'SQLiteDOCacheTransaction';

	// @ts-expect-error - DurableObjectTransaction is not a SQLiteTransaction
	override async transaction<T>(transaction: (tx: DurableObjectTransaction) => Promise<T>): Promise<T> {
		// @ts-expect-error
		return await this.session.transaction(transaction);
	}

}

export class SQLiteDOCachePreparedQuery<T extends PreparedQueryConfig = PreparedQueryConfig> extends PreparedQueryBase<{
	type: 'async';
	run: void;
	all: T['all'];
	get: T['get'];
	values: T['values'];
	execute: T['execute'];
}> {
	static override readonly [entityKind]: string = 'SQLiteDOCachePreparedQuery';

	/** @internal */
	customResultMapper?: (rows: unknown[][], mapColumnValue?: (value: unknown) => unknown) => unknown;

	/** @internal */
	fields?: SelectedFieldsOrdered;

	constructor(
		private client: DurableObjectStorage,
		query: Query,
		private logger: Logger,
		cache: Cache,
		queryMetadata: {
			type: 'select' | 'update' | 'delete' | 'insert';
			tables: string[];
		} | undefined,
		cacheConfig: WithCacheConfig | undefined,
		fields: SelectedFieldsOrdered | undefined,
		executeMethod: SQLiteExecuteMethod,
		private _isResponseInArrayMode: boolean,
		customResultMapper?: (rows: unknown[][]) => unknown,
	) {
		super('async', executeMethod, query, cache, queryMetadata, cacheConfig);
		this.customResultMapper = customResultMapper;
		this.fields = fields;
	}

	async run(placeholderValues?: Record<string, unknown>): Promise<void> {
		const params = fillPlaceholders(this.query.params, placeholderValues ?? {});
		this.logger.logQuery(this.query.sql, params);

		return await this.queryWithCache(this.query.sql, params, async () => {
			return new Promise<void>((resolve, reject) => {
				try {
					params.length > 0 
						? this.client.sql.exec(this.query.sql, ...params) 
						: this.client.sql.exec(this.query.sql);
					resolve();
				} catch (error) {
					reject(error);
				}
			});
		});
	}

	async all(placeholderValues?: Record<string, unknown>): Promise<T['all']> {
		const { fields, query, logger, client, customResultMapper } = this;
		if (!fields && !customResultMapper) {
			const params = fillPlaceholders(query.params, placeholderValues ?? {});
			logger.logQuery(query.sql, params);
			return await this.queryWithCache(query.sql, params, async () => {
				return new Promise<T['all']>((resolve, reject) => {
					try {
						const result = params.length > 0 
							? client.sql.exec(query.sql, ...params).toArray() 
							: client.sql.exec(query.sql).toArray();
						resolve(result as T['all']);
					} catch (error) {
						reject(error);
					}
				});
			});
		}

		const rows = await this.values(placeholderValues);
		return this.mapAllResult(rows);
	}

	override mapAllResult(rows: unknown, isFromBatch?: boolean): unknown {
		if (!this.fields && !this.customResultMapper) {
			return rows;
		}

		if (this.customResultMapper) {
			return this.customResultMapper(rows as unknown[][]);
		}

		return (rows as unknown[][]).map((row) => mapResultRow(this.fields!, row, this.joinsNotNullableMap));
	}

	async get(placeholderValues?: Record<string, unknown>): Promise<T['get']> {
		const { fields, joinsNotNullableMap, query, logger, client, customResultMapper } = this;
		if (!fields && !customResultMapper) {
			const params = fillPlaceholders(query.params, placeholderValues ?? {});
			logger.logQuery(query.sql, params);
			return await this.queryWithCache(query.sql, params, async () => {
				return new Promise<T['get']>((resolve, reject) => {
					try {
						const result = (params.length > 0 
							? client.sql.exec(query.sql, ...params) 
							: client.sql.exec(query.sql)).next().value;
						resolve(result as T['get']);
					} catch (error) {
						reject(error);
					}
				});
			});
		}

		const rows = await this.values(placeholderValues) as unknown[][];
		const row = rows[0];

		if (!row) {
			return undefined;
		}

		if (customResultMapper) {
			return customResultMapper(rows) as T['get'];
		}

		return mapResultRow(fields!, row, joinsNotNullableMap);
	}

	override mapGetResult(result: unknown, isFromBatch?: boolean): unknown {
		if (!this.fields && !this.customResultMapper) {
			return result;
		}

		if (this.customResultMapper) {
			return this.customResultMapper([result as unknown[]]) as T['all'];
		}

		return mapResultRow(this.fields!, result as unknown[], this.joinsNotNullableMap);
	}

	async values<TValue extends any[] = unknown[]>(placeholderValues?: Record<string, unknown>): Promise<TValue[]> {
		const params = fillPlaceholders(this.query.params, placeholderValues ?? {});
		this.logger.logQuery(this.query.sql, params);
		return await this.queryWithCache(this.query.sql, params, async () => {
			return new Promise<TValue[]>((resolve, reject) => {
				try {
					const res = params.length > 0
						? this.client.sql.exec(this.query.sql, ...params)
						: this.client.sql.exec(this.query.sql);

					// @ts-ignore .raw().toArray() exists
					const result = res.raw().toArray() as TValue[];
					resolve(result);
				} catch (error) {
					reject(error);
				}
			});
		});
	}

	/** @internal */
	isResponseInArrayMode(): boolean {
		return this._isResponseInArrayMode;
	}
}

