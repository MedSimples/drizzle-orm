import { randomUUID } from 'crypto';
import fs from 'fs';
import { CasingType } from './cli/validations/common';
import { serializeSQLite } from './serializer';
import { drySQLite, SQLiteSchema, sqliteSchema } from './serializer/sqliteSchema';

export const prepareSQLiteDbPushSnapshot = async (
	prev: SQLiteSchema,
	schemaPath: string | string[],
	casing: CasingType | undefined,
): Promise<{ prev: SQLiteSchema; cur: SQLiteSchema }> => {
	const serialized = await serializeSQLite(schemaPath, casing);

	const id = randomUUID();
	const idPrev = prev.id;

	const { version, dialect, ...rest } = serialized;
	const result: SQLiteSchema = {
		version,
		dialect,
		id,
		prevId: idPrev,
		...rest,
	};

	return { prev, cur: result };
};

export const prepareSqliteMigrationSnapshot = async (
	snapshots: string[],
	schemaPath: string | string[],
	casing: CasingType | undefined,
): Promise<{ prev: SQLiteSchema; cur: SQLiteSchema; custom: SQLiteSchema }> => {
	const prevSnapshot = sqliteSchema.parse(
		preparePrevSnapshot(snapshots, drySQLite),
	);
	const serialized = await serializeSQLite(schemaPath, casing);

	const id = randomUUID();
	const idPrev = prevSnapshot.id;

	const { version, dialect, ...rest } = serialized;
	const result: SQLiteSchema = {
		version,
		dialect,
		id,
		prevId: idPrev,
		...rest,
	};

	const { id: _ignoredId, prevId: _ignoredPrevId, ...prevRest } = prevSnapshot;

	// that's for custom migrations, when we need new IDs, but old snapshot
	const custom: SQLiteSchema = {
		id,
		prevId: idPrev,
		...prevRest,
	};

	return { prev: prevSnapshot, cur: result, custom };
};


const preparePrevSnapshot = (snapshots: string[], defaultPrev: any) => {
	let prevSnapshot: any;

	if (snapshots.length === 0) {
		prevSnapshot = defaultPrev;
	} else {
		const lastSnapshot = snapshots[snapshots.length - 1];
		prevSnapshot = JSON.parse(fs.readFileSync(lastSnapshot).toString());
	}
	return prevSnapshot;
};
