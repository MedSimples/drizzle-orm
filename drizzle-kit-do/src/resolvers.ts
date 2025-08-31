// Simplified resolvers for pushSchema API without CLI prompts
import type { View as SQLiteView } from './serializer/sqliteSchema';

// Simplified types to avoid complex dependencies
type ResolverInput<T> = {
	created: T[];
	deleted: T[];
};

type ResolverOutputWithMoved<T> = {
	created: T[];
	deleted: T[];
	moved: T[];
	renamed: T[];
};

type ColumnsResolverInput<T> = {
	tableName: string;
	schema: string;
	created: T[];
	deleted: T[];
};

type ColumnsResolverOutput<T> = {
	tableName: string;
	schema: string;
	created: T[];
	deleted: T[];
	renamed: T[];
};

type Table = any;
type Column = any;

export const tablesResolver = async (
	input: ResolverInput<Table>,
): Promise<ResolverOutputWithMoved<Table>> => {
	return {
		created: input.created,
		deleted: input.deleted,
		moved: [],
		renamed: [],
	};
};

export const sqliteViewsResolver = async (
	input: ResolverInput<SQLiteView & { schema: '' }>,
): Promise<ResolverOutputWithMoved<SQLiteView>> => {
	return {
		created: input.created,
		deleted: input.deleted,
		moved: [],
		renamed: [],
	};
};

export const columnsResolver = async (
	input: ColumnsResolverInput<Column>,
): Promise<ColumnsResolverOutput<Column>> => {
	return {
		tableName: input.tableName,
		schema: input.schema,
		created: input.created,
		deleted: input.deleted,
		renamed: [],
	};
};
