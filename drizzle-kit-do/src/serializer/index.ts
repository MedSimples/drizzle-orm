import { CasingType } from 'src/cli/validations/common';
import type { SQLiteSchemaInternal } from './sqliteSchema';
// import { prepareFromSqliteImports } from './sqliteImports';
// import { generateSqliteSnapshot } from './sqliteSerializer';

export const serializeSQLite = async (
	path: string | string[],
	casing: CasingType | undefined,
): Promise<SQLiteSchemaInternal> => {
	// const filenames = prepareFilenames(path);

	// const { tables, views } = await prepareFromSqliteImports(filenames);
	// return generateSqliteSnapshot(tables, views, casing);
};

