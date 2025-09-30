import type { MigrationConfig } from 'drizzle-orm/migrator';
import {
	type SQLiteDB
} from '../utils';
// import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/libsql/migrator';

const prepareSqliteParams = (params: any[], driver?: string) => {
	return params.map((param) => {
		if (
			param
			&& typeof param === 'object'
			&& 'type' in param
			&& 'value' in param
			&& param.type === 'binary'
		) {
			const value = typeof param.value === 'object'
				? JSON.stringify(param.value)
				: (param.value as string);

			if (driver === 'd1-http') {
				return value;
			}

			return Buffer.from(value);
		}
		return param;
	});
};

export const connectToSQLite = async (
	storage: any,
): Promise<
	& SQLiteDB
	& {
		packageName: 'd1-http' | '@libsql/client';
		migrate: (config: MigrationConfig) => Promise<void>;
		proxy: Proxy;
		transactionProxy: TransactionProxy;
	}
> => {
	const drzl = drizzle(storage);
	const migrateFn = async (config: MigrationConfig) => {
		return migrate(drzl as any, config);
	};

	const db: SQLiteDB = {
		query: async <T>(sql: string, params?: any[]) => {
			const res = await client.execute({ sql, args: params || [] });
			return res.rows as T[];
		},
		run: async (query: string) => {
			await client.execute(query);
		},
	};

	type Transaction = Awaited<ReturnType<typeof client.transaction>>;

	const proxy = async (params: ProxyParams) => {
		const preparedParams = prepareSqliteParams(params.params || []);
		const result = await client.execute({
			sql: params.sql,
			args: preparedParams,
		});

		if (params.mode === 'array') {
			return result.rows.map((row) => Object.values(row));
		} else {
			return result.rows;
		}
	};

	const transactionProxy: TransactionProxy = async (queries) => {
		const results: (any[] | Error)[] = [];
		let transaction: Transaction | null = null;
		try {
			transaction = await client.transaction();
			for (const query of queries) {
				const result = await transaction.execute(query.sql);
				results.push(result.rows);
			}
			await transaction.commit();
		} catch (error) {
			results.push(error as Error);
			await transaction?.rollback();
		} finally {
			transaction?.close();
		}
		return results;
	};

	return { ...db, packageName: '@libsql/client', proxy, transactionProxy, migrate: migrateFn };
};

