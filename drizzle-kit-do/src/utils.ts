import { parse } from 'url';
import { assertUnreachable, snapshotVersion } from './global';
import { backwardCompatibleSqliteSchema, Dialect } from './serializer/sqliteSchema';

export type DB = {
	query: <T extends any = any>(sql: string, params?: any[]) => Promise<T[]>;
};

export type SQLiteDB = {
	query: <T extends any = any>(sql: string, params?: any[]) => Promise<T[]>;
	run(query: string): Promise<void>;
};

export type LibSQLDB = {
	query: <T extends any = any>(sql: string, params?: any[]) => Promise<T[]>;
	run(query: string): Promise<void>;
	batchWithPragma?(queries: string[]): Promise<void>;
};

export const copy = <T>(it: T): T => {
	return JSON.parse(JSON.stringify(it));
};

export const objectValues = <T extends object>(obj: T): Array<T[keyof T]> => {
	return Object.values(obj);
};

export type Journal = {
	version: string;
	dialect: Dialect;
	entries: {
		idx: number;
		version: string;
		when: number;
		tag: string;
		breakpoints: boolean;
	}[];
};

export const dryJournal = (dialect: Dialect): Journal => {
	return {
		version: snapshotVersion,
		dialect,
		entries: [],
	};
};

// export const preparePushFolder = (dialect: Dialect) => {
//   const out = ".drizzle";
//   let snapshot: string = "";
//   if (!existsSync(join(out))) {
//     mkdirSync(out);
//     snapshot = JSON.stringify(dryJournal(dialect));
//   } else {
//     snapshot = readdirSync(out)[0];
//   }

//   return { snapshot };
// };

const validatorForDialect = (dialect: Dialect) => {
	switch (dialect) {
		case 'sqlite':
			return { validator: backwardCompatibleSqliteSchema, version: 6 };
	}
};


export const prepareMigrationMeta = (
	schemas: { from: string; to: string }[],
	tables: { from: NamedWithSchema; to: NamedWithSchema }[],
	columns: {
		from: { table: string; schema: string; column: string };
		to: { table: string; schema: string; column: string };
	}[],
) => {
	const _meta = {
		schemas: {} as Record<string, string>,
		tables: {} as Record<string, string>,
		columns: {} as Record<string, string>,
	};

	schemas.forEach((it) => {
		const from = schemaRenameKey(it.from);
		const to = schemaRenameKey(it.to);
		_meta.schemas[from] = to;
	});
	tables.forEach((it) => {
		const from = tableRenameKey(it.from);
		const to = tableRenameKey(it.to);
		_meta.tables[from] = to;
	});

	columns.forEach((it) => {
		const from = columnRenameKey(it.from.table, it.from.schema, it.from.column);
		const to = columnRenameKey(it.to.table, it.to.schema, it.to.column);
		_meta.columns[from] = to;
	});

	return _meta;
};

export const schemaRenameKey = (it: string) => {
	return it;
};

export const tableRenameKey = (it: NamedWithSchema) => {
	const out = it.schema ? `"${it.schema}"."${it.name}"` : `"${it.name}"`;
	return out;
};

export const columnRenameKey = (
	table: string,
	schema: string,
	column: string,
) => {
	const out = schema
		? `"${schema}"."${table}"."${column}"`
		: `"${table}"."${column}"`;
	return out;
};

export const kloudMeta = () => {
	return {
		pg: [5],
		mysql: [] as number[],
		sqlite: [] as number[],
	};
};

export const normaliseSQLiteUrl = (
	it: string,
	type: 'libsql' | 'better-sqlite',
) => {
	if (type === 'libsql') {
		if (it.startsWith('file:')) {
			return it;
		}
		try {
			const url = parse(it);
			if (url.protocol === null) {
				return `file:${it}`;
			}
			return it;
		} catch (e) {
			return `file:${it}`;
		}
	}

	if (type === 'better-sqlite') {
		if (it.startsWith('file:')) {
			return it.substring(5);
		}

		return it;
	}

	assertUnreachable(type);
};

export const normalisePGliteUrl = (
	it: string,
) => {
	if (it.startsWith('file:')) {
		return it.substring(5);
	}

	return it;
};

export function isPgArrayType(sqlType: string) {
	return sqlType.match(/.*\[\d*\].*|.*\[\].*/g) !== null;
}

export function findAddedAndRemoved(columnNames1: string[], columnNames2: string[]) {
	const set1 = new Set(columnNames1);
	const set2 = new Set(columnNames2);

	const addedColumns = columnNames2.filter((it) => !set1.has(it));
	const removedColumns = columnNames1.filter((it) => !set2.has(it));

	return { addedColumns, removedColumns };
}

export function escapeSingleQuotes(str: string) {
	return str.replace(/'/g, "''");
}

export function unescapeSingleQuotes(str: string, ignoreFirstAndLastChar: boolean) {
	const regex = ignoreFirstAndLastChar ? /(?<!^)'(?!$)/g : /'/g;
	return str.replace(/''/g, "'").replace(regex, "\\'");
}
