import { originUUID } from './global';
import { Minimatch } from 'minimatch';
import type { SQLiteSchema } from './serializer/sqliteSchema';
import { fromDatabase } from './serializer/sqliteSerializer';
import type { SQLiteDB } from './utils';

export const simplifiedSqlitePushIntrospect = async (db: SQLiteDB, filters: string[]) => {
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
	return { schema };
};
