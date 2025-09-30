import { Minimatch } from 'minimatch';
import { originUUID } from '../../global';
import { schemaToTypeScript } from '../../introspect-sqlite';
import type { SQLiteSchema } from '../../serializer/sqliteSchema';
import { fromDatabase } from '../../serializer/sqliteSerializer';
import { debug, type SQLiteDB } from '../../utils';
import { Casing } from '../validations/common';
import type { SqliteCredentials } from '../validations/sqlite';
import { connectToSQLite } from '../connections';

export const sqliteIntrospect = async (
	credentials: SqliteCredentials,
	filters: string[],
	casing: Casing,
) => {
	const db = await connectToSQLite(credentials);

	const matchers = filters.map((it) => {
		return new Minimatch(it);
	});

	const filter = (tableName: string) => {
		if (matchers.length === 0) return true;

		let flags: boolean[] = [];

		for (let matcher of matchers) {
			if (matcher.negate) {
				if (!matcher.match(tableName)) {
					flags.push(false);
				}
			}

			if (matcher.match(tableName)) {
				flags.push(true);
			}
		}

		if (flags.length > 0) {
			return flags.every(Boolean);
		}
		return false;
	};

	const res = await fromDatabase(db, filter);
	const schema = { id: originUUID, prevId: '', ...res } as SQLiteSchema;
	const ts = schemaToTypeScript(schema, casing);
	return { schema, ts };
};

export const sqlitePushIntrospect = async (db: SQLiteDB, filters: string[]) => {
	const matchers = filters.map((it) => {
		return new Minimatch(it);
	});

	const filter = (table: string) => {
		const applyFilter = () => {
			if (matchers.length === 0) return true;

			let flags: boolean[] = [];
	
			for (let matcher of matchers) {
				if (matcher.negate) {
					if (!matcher.match(table)) {
						flags.push(false);
					}
				}
	
				if (matcher.match(table)) {
					flags.push(true);
				}
			}
	
			if (flags.length > 0) {
				return flags.every(Boolean);
			}
			return false;
		}
    const result = applyFilter();
		debug('::sqlitePushIntrospect()', {
			matchers,
			filters,
			table,
			result,
		});
		return result;
	};

	const res = await fromDatabase(db, filter)

	const schema = { id: originUUID, prevId: '', ...res } as SQLiteSchema;
	return { schema };
};
