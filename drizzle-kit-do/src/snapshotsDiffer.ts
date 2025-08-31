import {
	any,
	array,
	boolean,
	enum as enumType,
	literal,
	never,
	object,
	record,
	string,
	TypeOf,
	union,
	ZodTypeAny,
} from 'zod';
import { applyJsonDiff, diffColumns, diffSchemasOrTables } from './jsonDiffer';
import { fromJson } from './sqlgenerator';

import {
	_prepareDropColumns,
	_prepareSqliteAddColumns,
	prepareAddCheckConstraint,
	prepareAddCompositePrimaryKeySqlite,
	prepareAlterCompositePrimaryKeySqlite,
	prepareAlterReferencesJson,
	prepareCreateIndexesJson,
	prepareCreateReferencesJson,
	prepareDeleteCheckConstraint,
	prepareDeleteCompositePrimaryKeySqlite,
	prepareDropIndexesJson,
	prepareDropReferencesJson,
	prepareDropTableJson,
	prepareDropViewJson,
	prepareLibSQLCreateReferencesJson,
	prepareLibSQLDropReferencesJson,
	prepareRenameColumns,
	prepareRenameTableJson,
	prepareSqliteAlterColumns,
	prepareSQLiteCreateTable,
	prepareSqliteCreateViewJson,
	prepareAddUniqueConstraintPg as prepareAddUniqueConstraint,
	prepareDeleteUniqueConstraintPg as prepareDeleteUniqueConstraint,
} from './jsonStatements';

import { mapEntries, mapKeys } from './global';
import { SQLiteSchema, SQLiteSchemaSquashed, SQLiteSquasher, View as SqliteView } from './serializer/sqliteSchema';
import { libSQLCombineStatements, sqliteCombineStatements } from './statementCombiner';
import { copy, prepareMigrationMeta } from './utils';

const makeChanged = <T extends ZodTypeAny>(schema: T) => {
	return object({
		type: enumType(['changed']),
		old: schema,
		new: schema,
	});
};

const makeSelfOrChanged = <T extends ZodTypeAny>(schema: T) => {
	return union([
		schema,
		object({
			type: enumType(['changed']),
			old: schema,
			new: schema,
		}),
	]);
};

export const makePatched = <T extends ZodTypeAny>(schema: T) => {
	return union([
		object({
			type: literal('added'),
			value: schema,
		}),
		object({
			type: literal('deleted'),
			value: schema,
		}),
		object({
			type: literal('changed'),
			old: schema,
			new: schema,
		}),
	]);
};

export const makeSelfOrPatched = <T extends ZodTypeAny>(schema: T) => {
	return union([
		object({
			type: literal('none'),
			value: schema,
		}),
		object({
			type: literal('added'),
			value: schema,
		}),
		object({
			type: literal('deleted'),
			value: schema,
		}),
		object({
			type: literal('changed'),
			old: schema,
			new: schema,
		}),
	]);
};

const columnSchema = object({
	name: string(),
	type: string(),
	typeSchema: string().optional(),
	primaryKey: boolean().optional(),
	default: any().optional(),
	notNull: boolean().optional(),
	// should it be optional? should if be here?
	autoincrement: boolean().optional(),
	onUpdate: boolean().optional(),
	isUnique: any().optional(),
	uniqueName: string().optional(),
	nullsNotDistinct: boolean().optional(),
	generated: object({
		as: string(),
		type: enumType(['stored', 'virtual']).default('stored'),
	}).optional(),
	identity: string().optional(),
}).strict();

const alteredColumnSchema = object({
	name: makeSelfOrChanged(string()),
	type: makeChanged(string()).optional(),
	default: makePatched(any()).optional(),
	primaryKey: makePatched(boolean()).optional(),
	notNull: makePatched(boolean()).optional(),
	typeSchema: makePatched(string()).optional(),
	onUpdate: makePatched(boolean()).optional(),
	autoincrement: makePatched(boolean()).optional(),
	generated: makePatched(
		object({
			as: string(),
			type: enumType(['stored', 'virtual']).default('stored'),
		}),
	).optional(),

	identity: makePatched(string()).optional(),
}).strict();

const enumSchema = object({
	name: string(),
	schema: string(),
	values: array(string()),
}).strict();

const changedEnumSchema = object({
	name: string(),
	schema: string(),
	addedValues: object({
		before: string(),
		value: string(),
	}).array(),
	deletedValues: array(string()),
}).strict();

const tableScheme = object({
	name: string(),
	schema: string().default(''),
	columns: record(string(), columnSchema),
	indexes: record(string(), string()),
	foreignKeys: record(string(), string()),
	compositePrimaryKeys: record(string(), string()).default({}),
	uniqueConstraints: record(string(), string()).default({}),
	policies: record(string(), string()).default({}),
	checkConstraints: record(string(), string()).default({}),
	isRLSEnabled: boolean().default(false),
}).strict();

export const alteredTableScheme = object({
	name: string(),
	schema: string(),
	altered: alteredColumnSchema.array(),
	addedIndexes: record(string(), string()),
	deletedIndexes: record(string(), string()),
	alteredIndexes: record(
		string(),
		object({
			__new: string(),
			__old: string(),
		}).strict(),
	),
	addedForeignKeys: record(string(), string()),
	deletedForeignKeys: record(string(), string()),
	alteredForeignKeys: record(
		string(),
		object({
			__new: string(),
			__old: string(),
		}).strict(),
	),
	addedCompositePKs: record(string(), string()),
	deletedCompositePKs: record(string(), string()),
	alteredCompositePKs: record(
		string(),
		object({
			__new: string(),
			__old: string(),
		}),
	),
	addedUniqueConstraints: record(string(), string()),
	deletedUniqueConstraints: record(string(), string()),
	alteredUniqueConstraints: record(
		string(),
		object({
			__new: string(),
			__old: string(),
		}),
	),
	addedPolicies: record(string(), string()),
	deletedPolicies: record(string(), string()),
	alteredPolicies: record(
		string(),
		object({
			__new: string(),
			__old: string(),
		}),
	),
	addedCheckConstraints: record(
		string(),
		string(),
	),
	deletedCheckConstraints: record(
		string(),
		string(),
	),
	alteredCheckConstraints: record(
		string(),
		object({
			__new: string(),
			__old: string(),
		}),
	),
}).strict();

const alteredViewCommon = object({
	name: string(),
	alteredDefinition: object({
		__old: string(),
		__new: string(),
	}).strict().optional(),
	alteredExisting: object({
		__old: boolean(),
		__new: boolean(),
	}).strict().optional(),
});

export const diffResultSchemeSQLite = object({
	alteredTablesWithColumns: alteredTableScheme.array(),
	alteredEnums: never().array(),
	alteredViews: alteredViewCommon.array(),
});

export type Column = TypeOf<typeof columnSchema>;
export type AlteredColumn = TypeOf<typeof alteredColumnSchema>;
export type Enum = TypeOf<typeof enumSchema>;
export type Table = TypeOf<typeof tableScheme>;
export type AlteredTable = TypeOf<typeof alteredTableScheme>;
export type DiffResultSQLite = TypeOf<typeof diffResultSchemeSQLite>;

export interface ResolverInput<T extends { name: string }> {
	created: T[];
	deleted: T[];
}

export interface ResolverOutput<T extends { name: string }> {
	created: T[];
	renamed: { from: T; to: T }[];
	deleted: T[];
}

export interface ResolverOutputWithMoved<T extends { name: string }> {
	created: T[];
	moved: { name: string; schemaFrom: string; schemaTo: string }[];
	renamed: { from: T; to: T }[];
	deleted: T[];
}

export interface ColumnsResolverInput<T extends { name: string }> {
	tableName: string;
	schema: string;
	created: T[];
	deleted: T[];
}

export interface TablePolicyResolverInput<T extends { name: string }> {
	tableName: string;
	schema: string;
	created: T[];
	deleted: T[];
}

export interface TablePolicyResolverOutput<T extends { name: string }> {
	tableName: string;
	schema: string;
	created: T[];
	renamed: { from: T; to: T }[];
	deleted: T[];
}

export interface PolicyResolverInput<T extends { name: string }> {
	created: T[];
	deleted: T[];
}

export interface PolicyResolverOutput<T extends { name: string }> {
	created: T[];
	renamed: { from: T; to: T }[];
	deleted: T[];
}

export interface RolesResolverInput<T extends { name: string }> {
	created: T[];
	deleted: T[];
}

export interface RolesResolverOutput<T extends { name: string }> {
	created: T[];
	renamed: { from: T; to: T }[];
	deleted: T[];
}

export interface ColumnsResolverOutput<T extends { name: string }> {
	tableName: string;
	schema: string;
	created: T[];
	renamed: { from: T; to: T }[];
	deleted: T[];
}

const nameChangeFor = (table: Named, renamed: { from: Named; to: Named }[]) => {
	for (let ren of renamed) {
		if (table.name === ren.from.name) {
			return { name: ren.to.name };
		}
	}

	return {
		name: table.name,
	};
};

const columnChangeFor = (
	column: string,
	renamedColumns: { from: Named; to: Named }[],
) => {
	for (let ren of renamedColumns) {
		if (column === ren.from.name) {
			return ren.to.name;
		}
	}

	return column;
};

// resolve roles same as enums
// create new json statements
// sql generators

// tests everything!

export const applySqliteSnapshotsDiff = async (
	json1: SQLiteSchemaSquashed,
	json2: SQLiteSchemaSquashed,
	tablesResolver: (
		input: ResolverInput<Table>,
	) => Promise<ResolverOutputWithMoved<Table>>,
	columnsResolver: (
		input: ColumnsResolverInput<Column>,
	) => Promise<ColumnsResolverOutput<Column>>,
	viewsResolver: (
		input: ResolverInput<SqliteView & { schema: '' }>,
	) => Promise<ResolverOutputWithMoved<SqliteView>>,
	curFull: SQLiteSchema,
	action?: 'push' | undefined,
): Promise<{
	statements: JsonStatement[];
	sqlStatements: string[];
	_meta:
		| {
			schemas: {};
			tables: {};
			columns: {};
		}
		| undefined;
}> => {
	const tablesDiff = diffSchemasOrTables(json1.tables, json2.tables);

	const {
		created: createdTables,
		deleted: deletedTables,
		renamed: renamedTables,
	} = await tablesResolver({
		created: tablesDiff.added,
		deleted: tablesDiff.deleted,
	});

	const tablesPatchedSnap1 = copy(json1);
	tablesPatchedSnap1.tables = mapEntries(tablesPatchedSnap1.tables, (_, it) => {
		const { name } = nameChangeFor(it, renamedTables);
		it.name = name;
		return [name, it];
	});

	const res = diffColumns(tablesPatchedSnap1.tables, json2.tables);

	const columnRenames = [] as {
		table: string;
		renames: { from: Column; to: Column }[];
	}[];

	const columnCreates = [] as {
		table: string;
		columns: Column[];
	}[];

	const columnDeletes = [] as {
		table: string;
		columns: Column[];
	}[];

	for (let entry of Object.values(res)) {
		const { renamed, created, deleted } = await columnsResolver({
			tableName: entry.name,
			schema: entry.schema,
			deleted: entry.columns.deleted,
			created: entry.columns.added,
		});

		if (created.length > 0) {
			columnCreates.push({
				table: entry.name,
				columns: created,
			});
		}

		if (deleted.length > 0) {
			columnDeletes.push({
				table: entry.name,
				columns: deleted,
			});
		}

		if (renamed.length > 0) {
			columnRenames.push({
				table: entry.name,
				renames: renamed,
			});
		}
	}

	const columnRenamesDict = columnRenames.reduce(
		(acc, it) => {
			acc[it.table] = it.renames;
			return acc;
		},
		{} as Record<
			string,
			{
				from: Named;
				to: Named;
			}[]
		>,
	);

	const columnsPatchedSnap1 = copy(tablesPatchedSnap1);
	columnsPatchedSnap1.tables = mapEntries(
		columnsPatchedSnap1.tables,
		(tableKey, tableValue) => {
			const patchedColumns = mapKeys(
				tableValue.columns,
				(columnKey, column) => {
					const rens = columnRenamesDict[tableValue.name] || [];
					const newName = columnChangeFor(columnKey, rens);
					column.name = newName;
					return newName;
				},
			);

			tableValue.columns = patchedColumns;
			return [tableKey, tableValue];
		},
	);

	const viewsDiff = diffSchemasOrTables(json1.views, json2.views);

	const {
		created: createdViews,
		deleted: deletedViews,
		renamed: renamedViews, // renamed or moved
	} = await viewsResolver({
		created: viewsDiff.added,
		deleted: viewsDiff.deleted,
	});

	const renamesViewDic: Record<string, { to: string; from: string }> = {};
	renamedViews.forEach((it) => {
		renamesViewDic[it.from.name] = { to: it.to.name, from: it.from.name };
	});

	const viewsPatchedSnap1 = copy(columnsPatchedSnap1);
	viewsPatchedSnap1.views = mapEntries(
		viewsPatchedSnap1.views,
		(viewKey, viewValue) => {
			const rename = renamesViewDic[viewValue.name];

			if (rename) {
				viewValue.name = rename.to;
			}

			return [viewKey, viewValue];
		},
	);

	const diffResult = applyJsonDiff(viewsPatchedSnap1, json2);

	const typedResult = diffResultSchemeSQLite.parse(diffResult);

	// Map array of objects to map
	const tablesMap: {
		[key: string]: (typeof typedResult.alteredTablesWithColumns)[number];
	} = {};

	typedResult.alteredTablesWithColumns.forEach((obj) => {
		tablesMap[obj.name] = obj;
	});

	const jsonCreateTables = createdTables.map((it) => {
		return prepareSQLiteCreateTable(it, action);
	});

	const jsonCreateIndexesForCreatedTables = createdTables
		.map((it) => {
			return prepareCreateIndexesJson(
				it.name,
				it.schema,
				it.indexes,
				curFull.internal,
			);
		})
		.flat();

	const jsonDropTables = deletedTables.map((it) => {
		return prepareDropTableJson(it);
	});

	const jsonRenameTables = renamedTables.map((it) => {
		return prepareRenameTableJson(it.from, it.to);
	});

	const jsonRenameColumnsStatements: JsonRenameColumnStatement[] = columnRenames
		.map((it) => prepareRenameColumns(it.table, '', it.renames))
		.flat();

	const jsonDropColumnsStatemets: JsonDropColumnStatement[] = columnDeletes
		.map((it) => _prepareDropColumns(it.table, '', it.columns))
		.flat();

	const jsonAddColumnsStatemets: JsonSqliteAddColumnStatement[] = columnCreates
		.map((it) => {
			return _prepareSqliteAddColumns(
				it.table,
				it.columns,
				tablesMap[it.table] && tablesMap[it.table].addedForeignKeys
					? Object.values(tablesMap[it.table].addedForeignKeys)
					: [],
			);
		})
		.flat();

	const allAltered = typedResult.alteredTablesWithColumns;

	const jsonAddedCompositePKs: JsonCreateCompositePK[] = [];
	const jsonDeletedCompositePKs: JsonDeleteCompositePK[] = [];
	const jsonAlteredCompositePKs: JsonAlterCompositePK[] = [];

	const jsonAddedUniqueConstraints: JsonCreateUniqueConstraint[] = [];
	const jsonDeletedUniqueConstraints: JsonDeleteUniqueConstraint[] = [];
	const jsonAlteredUniqueConstraints: JsonAlterUniqueConstraint[] = [];

	const jsonDeletedCheckConstraints: JsonDeleteCheckConstraint[] = [];
	const jsonCreatedCheckConstraints: JsonCreateCheckConstraint[] = [];

	allAltered.forEach((it) => {
		// This part is needed to make sure that same columns in a table are not triggered for change
		// there is a case where orm and kit are responsible for pk name generation and one of them is not sorting name
		// We double-check that pk with same set of columns are both in added and deleted diffs
		let addedColumns: string[] = [];
		for (const addedPkName of Object.keys(it.addedCompositePKs)) {
			const addedPkColumns = it.addedCompositePKs[addedPkName];
			addedColumns = SQLiteSquasher.unsquashPK(addedPkColumns);
		}

		let deletedColumns: string[] = [];
		for (const deletedPkName of Object.keys(it.deletedCompositePKs)) {
			const deletedPkColumns = it.deletedCompositePKs[deletedPkName];
			deletedColumns = SQLiteSquasher.unsquashPK(deletedPkColumns);
		}

		// Don't need to sort, but need to add tests for it
		// addedColumns.sort();
		// deletedColumns.sort();

		const doPerformDeleteAndCreate = JSON.stringify(addedColumns) !== JSON.stringify(deletedColumns);

		let addedCompositePKs: JsonCreateCompositePK[] = [];
		let deletedCompositePKs: JsonDeleteCompositePK[] = [];
		let alteredCompositePKs: JsonAlterCompositePK[] = [];
		if (doPerformDeleteAndCreate) {
			addedCompositePKs = prepareAddCompositePrimaryKeySqlite(
				it.name,
				it.addedCompositePKs,
			);
			deletedCompositePKs = prepareDeleteCompositePrimaryKeySqlite(
				it.name,
				it.deletedCompositePKs,
			);
		}
		alteredCompositePKs = prepareAlterCompositePrimaryKeySqlite(
			it.name,
			it.alteredCompositePKs,
		);

		// add logic for unique constraints
		let addedUniqueConstraints: JsonCreateUniqueConstraint[] = [];
		let deletedUniqueConstraints: JsonDeleteUniqueConstraint[] = [];
		let alteredUniqueConstraints: JsonAlterUniqueConstraint[] = [];

		addedUniqueConstraints = prepareAddUniqueConstraint(
			it.name,
			it.schema,
			it.addedUniqueConstraints,
		);
		deletedUniqueConstraints = prepareDeleteUniqueConstraint(
			it.name,
			it.schema,
			it.deletedUniqueConstraints,
		);
		if (it.alteredUniqueConstraints) {
			const added: Record<string, string> = {};
			const deleted: Record<string, string> = {};
			for (const k of Object.keys(it.alteredUniqueConstraints)) {
				added[k] = it.alteredUniqueConstraints[k].__new;
				deleted[k] = it.alteredUniqueConstraints[k].__old;
			}
			addedUniqueConstraints.push(
				...prepareAddUniqueConstraint(it.name, it.schema, added),
			);
			deletedUniqueConstraints.push(
				...prepareDeleteUniqueConstraint(it.name, it.schema, deleted),
			);
		}

		let createdCheckConstraints: JsonCreateCheckConstraint[] = [];
		let deletedCheckConstraints: JsonDeleteCheckConstraint[] = [];

		addedUniqueConstraints = prepareAddUniqueConstraint(
			it.name,
			it.schema,
			it.addedUniqueConstraints,
		);
		deletedUniqueConstraints = prepareDeleteUniqueConstraint(
			it.name,
			it.schema,
			it.deletedUniqueConstraints,
		);
		if (it.alteredUniqueConstraints) {
			const added: Record<string, string> = {};
			const deleted: Record<string, string> = {};
			for (const k of Object.keys(it.alteredUniqueConstraints)) {
				added[k] = it.alteredUniqueConstraints[k].__new;
				deleted[k] = it.alteredUniqueConstraints[k].__old;
			}
			addedUniqueConstraints.push(
				...prepareAddUniqueConstraint(it.name, it.schema, added),
			);
			deletedUniqueConstraints.push(
				...prepareDeleteUniqueConstraint(it.name, it.schema, deleted),
			);
		}

		createdCheckConstraints = prepareAddCheckConstraint(it.name, it.schema, it.addedCheckConstraints);
		deletedCheckConstraints = prepareDeleteCheckConstraint(
			it.name,
			it.schema,
			it.deletedCheckConstraints,
		);

		// skip for push
		if (it.alteredCheckConstraints && action !== 'push') {
			const added: Record<string, string> = {};
			const deleted: Record<string, string> = {};

			for (const k of Object.keys(it.alteredCheckConstraints)) {
				added[k] = it.alteredCheckConstraints[k].__new;
				deleted[k] = it.alteredCheckConstraints[k].__old;
			}
			createdCheckConstraints.push(...prepareAddCheckConstraint(it.name, it.schema, added));
			deletedCheckConstraints.push(...prepareDeleteCheckConstraint(it.name, it.schema, deleted));
		}

		jsonAddedCompositePKs.push(...addedCompositePKs);
		jsonDeletedCompositePKs.push(...deletedCompositePKs);
		jsonAlteredCompositePKs.push(...alteredCompositePKs);

		jsonAddedUniqueConstraints.push(...addedUniqueConstraints);
		jsonDeletedUniqueConstraints.push(...deletedUniqueConstraints);
		jsonAlteredUniqueConstraints.push(...alteredUniqueConstraints);

		jsonCreatedCheckConstraints.push(...createdCheckConstraints);
		jsonDeletedCheckConstraints.push(...deletedCheckConstraints);
	});

	const rColumns = jsonRenameColumnsStatements.map((it) => {
		const tableName = it.tableName;
		const schema = it.schema;
		return {
			from: { schema, table: tableName, column: it.oldColumnName },
			to: { schema, table: tableName, column: it.newColumnName },
		};
	});

	const jsonTableAlternations = allAltered
		.map((it) => {
			return prepareSqliteAlterColumns(it.name, it.schema, it.altered, json2);
		})
		.flat();

	const jsonCreateIndexesForAllAlteredTables = allAltered
		.map((it) => {
			return prepareCreateIndexesJson(
				it.name,
				it.schema,
				it.addedIndexes || {},
				curFull.internal,
			);
		})
		.flat();

	const jsonDropIndexesForAllAlteredTables = allAltered
		.map((it) => {
			return prepareDropIndexesJson(
				it.name,
				it.schema,
				it.deletedIndexes || {},
			);
		})
		.flat();

	allAltered.forEach((it) => {
		const droppedIndexes = Object.keys(it.alteredIndexes).reduce(
			(current, item: string) => {
				current[item] = it.alteredIndexes[item].__old;
				return current;
			},
			{} as Record<string, string>,
		);
		const createdIndexes = Object.keys(it.alteredIndexes).reduce(
			(current, item: string) => {
				current[item] = it.alteredIndexes[item].__new;
				return current;
			},
			{} as Record<string, string>,
		);

		jsonCreateIndexesForAllAlteredTables.push(
			...prepareCreateIndexesJson(
				it.name,
				it.schema,
				createdIndexes || {},
				curFull.internal,
			),
		);
		jsonDropIndexesForAllAlteredTables.push(
			...prepareDropIndexesJson(it.name, it.schema, droppedIndexes || {}),
		);
	});

	const jsonReferencesForAllAlteredTables: JsonReferenceStatement[] = allAltered
		.map((it) => {
			const forAdded = prepareCreateReferencesJson(
				it.name,
				it.schema,
				it.addedForeignKeys,
			);

			const forAltered = prepareDropReferencesJson(
				it.name,
				it.schema,
				it.deletedForeignKeys,
			);

			const alteredFKs = prepareAlterReferencesJson(
				it.name,
				it.schema,
				it.alteredForeignKeys,
			);

			return [...forAdded, ...forAltered, ...alteredFKs];
		})
		.flat();

	const jsonCreatedReferencesForAlteredTables = jsonReferencesForAllAlteredTables.filter(
		(t) => t.type === 'create_reference',
	);
	const jsonDroppedReferencesForAlteredTables = jsonReferencesForAllAlteredTables.filter(
		(t) => t.type === 'delete_reference',
	);

	const createViews: JsonCreateSqliteViewStatement[] = [];
	const dropViews: JsonDropViewStatement[] = [];

	createViews.push(
		...createdViews.filter((it) => !it.isExisting).map((it) => {
			return prepareSqliteCreateViewJson(
				it.name,
				it.definition!,
			);
		}),
	);

	dropViews.push(
		...deletedViews.filter((it) => !it.isExisting).map((it) => {
			return prepareDropViewJson(it.name);
		}),
	);

	dropViews.push(
		...renamedViews.filter((it) => !it.to.isExisting).map((it) => {
			return prepareDropViewJson(it.from.name);
		}),
	);
	createViews.push(
		...renamedViews.filter((it) => !it.to.isExisting).map((it) => {
			return prepareSqliteCreateViewJson(it.to.name, it.to.definition!);
		}),
	);

	const alteredViews = typedResult.alteredViews.filter((it) => !json2.views[it.name].isExisting);

	for (const alteredView of alteredViews) {
		const { definition } = json2.views[alteredView.name];

		if (alteredView.alteredExisting || (alteredView.alteredDefinition && action !== 'push')) {
			dropViews.push(prepareDropViewJson(alteredView.name));

			createViews.push(
				prepareSqliteCreateViewJson(
					alteredView.name,
					definition!,
				),
			);
		}
	}

	const jsonStatements: JsonStatement[] = [];
	jsonStatements.push(...jsonCreateTables);

	jsonStatements.push(...jsonDropTables);
	jsonStatements.push(...jsonRenameTables);
	jsonStatements.push(...jsonRenameColumnsStatements);

	jsonStatements.push(...jsonDroppedReferencesForAlteredTables);
	jsonStatements.push(...jsonDeletedCheckConstraints);

	// Will need to drop indexes before changing any columns in table
	// Then should go column alternations and then index creation
	jsonStatements.push(...jsonDropIndexesForAllAlteredTables);

	jsonStatements.push(...jsonDeletedCompositePKs);
	jsonStatements.push(...jsonTableAlternations);
	jsonStatements.push(...jsonAddedCompositePKs);
	jsonStatements.push(...jsonAddColumnsStatemets);

	jsonStatements.push(...jsonCreateIndexesForCreatedTables);
	jsonStatements.push(...jsonCreateIndexesForAllAlteredTables);

	jsonStatements.push(...jsonCreatedCheckConstraints);

	jsonStatements.push(...jsonCreatedReferencesForAlteredTables);

	jsonStatements.push(...jsonDropColumnsStatemets);

	// jsonStatements.push(...jsonDeletedCompositePKs);
	// jsonStatements.push(...jsonAddedCompositePKs);
	jsonStatements.push(...jsonAlteredCompositePKs);

	jsonStatements.push(...jsonAlteredUniqueConstraints);

	jsonStatements.push(...dropViews);
	jsonStatements.push(...createViews);

	const combinedJsonStatements = sqliteCombineStatements(jsonStatements, json2, action);
	const sqlStatements = fromJson(combinedJsonStatements, 'sqlite');

	const uniqueSqlStatements: string[] = [];
	sqlStatements.forEach((ss) => {
		if (!uniqueSqlStatements.includes(ss)) {
			uniqueSqlStatements.push(ss);
		}
	});

	const rTables = renamedTables.map((it) => {
		return { from: it.from, to: it.to };
	});

	const _meta = prepareMigrationMeta([], rTables, rColumns);

	return {
		statements: combinedJsonStatements,
		sqlStatements: uniqueSqlStatements,
		_meta,
	};
};

export const applyLibSQLSnapshotsDiff = async (
	json1: SQLiteSchemaSquashed,
	json2: SQLiteSchemaSquashed,
	tablesResolver: (
		input: ResolverInput<Table>,
	) => Promise<ResolverOutputWithMoved<Table>>,
	columnsResolver: (
		input: ColumnsResolverInput<Column>,
	) => Promise<ColumnsResolverOutput<Column>>,
	viewsResolver: (
		input: ResolverInput<SqliteView & { schema: '' }>,
	) => Promise<ResolverOutputWithMoved<SqliteView>>,
	prevFull: SQLiteSchema,
	curFull: SQLiteSchema,
	action?: 'push',
): Promise<{
	statements: JsonStatement[];
	sqlStatements: string[];
	_meta:
		| {
			schemas: {};
			tables: {};
			columns: {};
		}
		| undefined;
}> => {
	const tablesDiff = diffSchemasOrTables(json1.tables, json2.tables);
	const {
		created: createdTables,
		deleted: deletedTables,
		renamed: renamedTables,
	} = await tablesResolver({
		created: tablesDiff.added,
		deleted: tablesDiff.deleted,
	});

	const tablesPatchedSnap1 = copy(json1);
	tablesPatchedSnap1.tables = mapEntries(tablesPatchedSnap1.tables, (_, it) => {
		const { name } = nameChangeFor(it, renamedTables);
		it.name = name;
		return [name, it];
	});

	const res = diffColumns(tablesPatchedSnap1.tables, json2.tables);

	const columnRenames = [] as {
		table: string;
		renames: { from: Column; to: Column }[];
	}[];

	const columnCreates = [] as {
		table: string;
		columns: Column[];
	}[];

	const columnDeletes = [] as {
		table: string;
		columns: Column[];
	}[];

	for (let entry of Object.values(res)) {
		const { renamed, created, deleted } = await columnsResolver({
			tableName: entry.name,
			schema: entry.schema,
			deleted: entry.columns.deleted,
			created: entry.columns.added,
		});

		if (created.length > 0) {
			columnCreates.push({
				table: entry.name,
				columns: created,
			});
		}

		if (deleted.length > 0) {
			columnDeletes.push({
				table: entry.name,
				columns: deleted,
			});
		}

		if (renamed.length > 0) {
			columnRenames.push({
				table: entry.name,
				renames: renamed,
			});
		}
	}

	const columnRenamesDict = columnRenames.reduce(
		(acc, it) => {
			acc[it.table] = it.renames;
			return acc;
		},
		{} as Record<
			string,
			{
				from: Named;
				to: Named;
			}[]
		>,
	);

	const columnsPatchedSnap1 = copy(tablesPatchedSnap1);
	columnsPatchedSnap1.tables = mapEntries(
		columnsPatchedSnap1.tables,
		(tableKey, tableValue) => {
			const patchedColumns = mapKeys(
				tableValue.columns,
				(columnKey, column) => {
					const rens = columnRenamesDict[tableValue.name] || [];
					const newName = columnChangeFor(columnKey, rens);
					column.name = newName;
					return newName;
				},
			);

			tableValue.columns = patchedColumns;
			return [tableKey, tableValue];
		},
	);

	const viewsDiff = diffSchemasOrTables(json1.views, json2.views);

	const {
		created: createdViews,
		deleted: deletedViews,
		renamed: renamedViews, // renamed or moved
	} = await viewsResolver({
		created: viewsDiff.added,
		deleted: viewsDiff.deleted,
	});

	const renamesViewDic: Record<string, { to: string; from: string }> = {};
	renamedViews.forEach((it) => {
		renamesViewDic[it.from.name] = { to: it.to.name, from: it.from.name };
	});

	const viewsPatchedSnap1 = copy(columnsPatchedSnap1);
	viewsPatchedSnap1.views = mapEntries(
		viewsPatchedSnap1.views,
		(viewKey, viewValue) => {
			const rename = renamesViewDic[viewValue.name];

			if (rename) {
				viewValue.name = rename.to;
			}

			return [viewKey, viewValue];
		},
	);

	const diffResult = applyJsonDiff(viewsPatchedSnap1, json2);

	const typedResult = diffResultSchemeSQLite.parse(diffResult);

	// Map array of objects to map
	const tablesMap: {
		[key: string]: (typeof typedResult.alteredTablesWithColumns)[number];
	} = {};

	typedResult.alteredTablesWithColumns.forEach((obj) => {
		tablesMap[obj.name] = obj;
	});

	const jsonCreateTables = createdTables.map((it) => {
		return prepareSQLiteCreateTable(it, action);
	});

	const jsonCreateIndexesForCreatedTables = createdTables
		.map((it) => {
			return prepareCreateIndexesJson(
				it.name,
				it.schema,
				it.indexes,
				curFull.internal,
			);
		})
		.flat();

	const jsonDropTables = deletedTables.map((it) => {
		return prepareDropTableJson(it);
	});

	const jsonRenameTables = renamedTables.map((it) => {
		return prepareRenameTableJson(it.from, it.to);
	});

	const jsonRenameColumnsStatements: JsonRenameColumnStatement[] = columnRenames
		.map((it) => prepareRenameColumns(it.table, '', it.renames))
		.flat();

	const jsonDropColumnsStatemets: JsonDropColumnStatement[] = columnDeletes
		.map((it) => _prepareDropColumns(it.table, '', it.columns))
		.flat();

	const jsonAddColumnsStatemets: JsonSqliteAddColumnStatement[] = columnCreates
		.map((it) => {
			return _prepareSqliteAddColumns(
				it.table,
				it.columns,
				tablesMap[it.table] && tablesMap[it.table].addedForeignKeys
					? Object.values(tablesMap[it.table].addedForeignKeys)
					: [],
			);
		})
		.flat();

	const rColumns = jsonRenameColumnsStatements.map((it) => {
		const tableName = it.tableName;
		const schema = it.schema;
		return {
			from: { schema, table: tableName, column: it.oldColumnName },
			to: { schema, table: tableName, column: it.newColumnName },
		};
	});

	const rTables = renamedTables.map((it) => {
		return { from: it.from, to: it.to };
	});

	const _meta = prepareMigrationMeta([], rTables, rColumns);

	const allAltered = typedResult.alteredTablesWithColumns;

	const jsonAddedCompositePKs: JsonCreateCompositePK[] = [];
	const jsonDeletedCompositePKs: JsonDeleteCompositePK[] = [];
	const jsonAlteredCompositePKs: JsonAlterCompositePK[] = [];

	const jsonAddedUniqueConstraints: JsonCreateUniqueConstraint[] = [];
	const jsonDeletedUniqueConstraints: JsonDeleteUniqueConstraint[] = [];
	const jsonAlteredUniqueConstraints: JsonAlterUniqueConstraint[] = [];

	const jsonDeletedCheckConstraints: JsonDeleteCheckConstraint[] = [];
	const jsonCreatedCheckConstraints: JsonCreateCheckConstraint[] = [];

	allAltered.forEach((it) => {
		// This part is needed to make sure that same columns in a table are not triggered for change
		// there is a case where orm and kit are responsible for pk name generation and one of them is not sorting name
		// We double-check that pk with same set of columns are both in added and deleted diffs
		let addedColumns: string[] = [];
		for (const addedPkName of Object.keys(it.addedCompositePKs)) {
			const addedPkColumns = it.addedCompositePKs[addedPkName];
			addedColumns = SQLiteSquasher.unsquashPK(addedPkColumns);
		}

		let deletedColumns: string[] = [];
		for (const deletedPkName of Object.keys(it.deletedCompositePKs)) {
			const deletedPkColumns = it.deletedCompositePKs[deletedPkName];
			deletedColumns = SQLiteSquasher.unsquashPK(deletedPkColumns);
		}

		// Don't need to sort, but need to add tests for it
		// addedColumns.sort();
		// deletedColumns.sort();

		const doPerformDeleteAndCreate = JSON.stringify(addedColumns) !== JSON.stringify(deletedColumns);

		let addedCompositePKs: JsonCreateCompositePK[] = [];
		let deletedCompositePKs: JsonDeleteCompositePK[] = [];
		let alteredCompositePKs: JsonAlterCompositePK[] = [];
		if (doPerformDeleteAndCreate) {
			addedCompositePKs = prepareAddCompositePrimaryKeySqlite(
				it.name,
				it.addedCompositePKs,
			);
			deletedCompositePKs = prepareDeleteCompositePrimaryKeySqlite(
				it.name,
				it.deletedCompositePKs,
			);
		}
		alteredCompositePKs = prepareAlterCompositePrimaryKeySqlite(
			it.name,
			it.alteredCompositePKs,
		);

		// add logic for unique constraints
		let addedUniqueConstraints: JsonCreateUniqueConstraint[] = [];
		let deletedUniqueConstraints: JsonDeleteUniqueConstraint[] = [];
		let alteredUniqueConstraints: JsonAlterUniqueConstraint[] = [];

		let createdCheckConstraints: JsonCreateCheckConstraint[] = [];
		let deletedCheckConstraints: JsonDeleteCheckConstraint[] = [];

		addedUniqueConstraints = prepareAddUniqueConstraint(
			it.name,
			it.schema,
			it.addedUniqueConstraints,
		);

		deletedUniqueConstraints = prepareDeleteUniqueConstraint(
			it.name,
			it.schema,
			it.deletedUniqueConstraints,
		);
		if (it.alteredUniqueConstraints) {
			const added: Record<string, string> = {};
			const deleted: Record<string, string> = {};
			for (const k of Object.keys(it.alteredUniqueConstraints)) {
				added[k] = it.alteredUniqueConstraints[k].__new;
				deleted[k] = it.alteredUniqueConstraints[k].__old;
			}
			addedUniqueConstraints.push(
				...prepareAddUniqueConstraint(it.name, it.schema, added),
			);
			deletedUniqueConstraints.push(
				...prepareDeleteUniqueConstraint(it.name, it.schema, deleted),
			);
		}

		createdCheckConstraints = prepareAddCheckConstraint(it.name, it.schema, it.addedCheckConstraints);
		deletedCheckConstraints = prepareDeleteCheckConstraint(
			it.name,
			it.schema,
			it.deletedCheckConstraints,
		);

		// skip for push
		if (it.alteredCheckConstraints && action !== 'push') {
			const added: Record<string, string> = {};
			const deleted: Record<string, string> = {};

			for (const k of Object.keys(it.alteredCheckConstraints)) {
				added[k] = it.alteredCheckConstraints[k].__new;
				deleted[k] = it.alteredCheckConstraints[k].__old;
			}
			createdCheckConstraints.push(...prepareAddCheckConstraint(it.name, it.schema, added));
			deletedCheckConstraints.push(...prepareDeleteCheckConstraint(it.name, it.schema, deleted));
		}

		jsonAddedCompositePKs.push(...addedCompositePKs);
		jsonDeletedCompositePKs.push(...deletedCompositePKs);
		jsonAlteredCompositePKs.push(...alteredCompositePKs);

		jsonAddedUniqueConstraints.push(...addedUniqueConstraints);
		jsonDeletedUniqueConstraints.push(...deletedUniqueConstraints);
		jsonAlteredUniqueConstraints.push(...alteredUniqueConstraints);

		jsonCreatedCheckConstraints.push(...createdCheckConstraints);
		jsonDeletedCheckConstraints.push(...deletedCheckConstraints);
	});

	const jsonTableAlternations = allAltered
		.map((it) => {
			return prepareSqliteAlterColumns(it.name, it.schema, it.altered, json2);
		})
		.flat();

	const jsonCreateIndexesForAllAlteredTables = allAltered
		.map((it) => {
			return prepareCreateIndexesJson(
				it.name,
				it.schema,
				it.addedIndexes || {},
				curFull.internal,
			);
		})
		.flat();

	const jsonDropIndexesForAllAlteredTables = allAltered
		.map((it) => {
			return prepareDropIndexesJson(
				it.name,
				it.schema,
				it.deletedIndexes || {},
			);
		})
		.flat();

	allAltered.forEach((it) => {
		const droppedIndexes = Object.keys(it.alteredIndexes).reduce(
			(current, item: string) => {
				current[item] = it.alteredIndexes[item].__old;
				return current;
			},
			{} as Record<string, string>,
		);
		const createdIndexes = Object.keys(it.alteredIndexes).reduce(
			(current, item: string) => {
				current[item] = it.alteredIndexes[item].__new;
				return current;
			},
			{} as Record<string, string>,
		);

		jsonCreateIndexesForAllAlteredTables.push(
			...prepareCreateIndexesJson(
				it.name,
				it.schema,
				createdIndexes || {},
				curFull.internal,
			),
		);
		jsonDropIndexesForAllAlteredTables.push(
			...prepareDropIndexesJson(it.name, it.schema, droppedIndexes || {}),
		);
	});

	const jsonReferencesForAllAlteredTables: JsonReferenceStatement[] = allAltered
		.map((it) => {
			const forAdded = prepareLibSQLCreateReferencesJson(
				it.name,
				it.schema,
				it.addedForeignKeys,
				json2,
				action,
			);

			const forAltered = prepareLibSQLDropReferencesJson(
				it.name,
				it.schema,
				it.deletedForeignKeys,
				json2,
				_meta,
				action,
			);

			const alteredFKs = prepareAlterReferencesJson(it.name, it.schema, it.alteredForeignKeys);

			return [...forAdded, ...forAltered, ...alteredFKs];
		})
		.flat();

	const jsonCreatedReferencesForAlteredTables = jsonReferencesForAllAlteredTables.filter(
		(t) => t.type === 'create_reference',
	);
	const jsonDroppedReferencesForAlteredTables = jsonReferencesForAllAlteredTables.filter(
		(t) => t.type === 'delete_reference',
	);

	const createViews: JsonCreateSqliteViewStatement[] = [];
	const dropViews: JsonDropViewStatement[] = [];

	createViews.push(
		...createdViews.filter((it) => !it.isExisting).map((it) => {
			return prepareSqliteCreateViewJson(
				it.name,
				it.definition!,
			);
		}),
	);

	dropViews.push(
		...deletedViews.filter((it) => !it.isExisting).map((it) => {
			return prepareDropViewJson(it.name);
		}),
	);

	// renames
	dropViews.push(
		...renamedViews.filter((it) => !it.to.isExisting).map((it) => {
			return prepareDropViewJson(it.from.name);
		}),
	);
	createViews.push(
		...renamedViews.filter((it) => !it.to.isExisting).map((it) => {
			return prepareSqliteCreateViewJson(it.to.name, it.to.definition!);
		}),
	);

	const alteredViews = typedResult.alteredViews.filter((it) => !json2.views[it.name].isExisting);

	for (const alteredView of alteredViews) {
		const { definition } = json2.views[alteredView.name];

		if (alteredView.alteredExisting || (alteredView.alteredDefinition && action !== 'push')) {
			dropViews.push(prepareDropViewJson(alteredView.name));

			createViews.push(
				prepareSqliteCreateViewJson(
					alteredView.name,
					definition!,
				),
			);
		}
	}

	const jsonStatements: JsonStatement[] = [];
	jsonStatements.push(...jsonCreateTables);

	jsonStatements.push(...jsonDropTables);
	jsonStatements.push(...jsonRenameTables);
	jsonStatements.push(...jsonRenameColumnsStatements);

	jsonStatements.push(...jsonDroppedReferencesForAlteredTables);

	jsonStatements.push(...jsonDeletedCheckConstraints);

	// Will need to drop indexes before changing any columns in table
	// Then should go column alternations and then index creation
	jsonStatements.push(...jsonDropIndexesForAllAlteredTables);

	jsonStatements.push(...jsonDeletedCompositePKs);
	jsonStatements.push(...jsonTableAlternations);
	jsonStatements.push(...jsonAddedCompositePKs);
	jsonStatements.push(...jsonAddColumnsStatemets);

	jsonStatements.push(...jsonCreateIndexesForCreatedTables);
	jsonStatements.push(...jsonCreateIndexesForAllAlteredTables);
	jsonStatements.push(...jsonCreatedCheckConstraints);

	jsonStatements.push(...dropViews);
	jsonStatements.push(...createViews);

	jsonStatements.push(...jsonCreatedReferencesForAlteredTables);

	jsonStatements.push(...jsonDropColumnsStatemets);

	jsonStatements.push(...jsonAlteredCompositePKs);

	jsonStatements.push(...jsonAlteredUniqueConstraints);

	const combinedJsonStatements = libSQLCombineStatements(jsonStatements, json2, action);

	const sqlStatements = fromJson(
		combinedJsonStatements,
		'turso',
		action,
		json2,
	);

	const uniqueSqlStatements: string[] = [];
	sqlStatements.forEach((ss) => {
		if (!uniqueSqlStatements.includes(ss)) {
			uniqueSqlStatements.push(ss);
		}
	});

	return {
		statements: combinedJsonStatements,
		sqlStatements: uniqueSqlStatements,
		_meta,
	};
};

// explicitely ask if tables were renamed, if yes - add those to altered tables, otherwise - deleted
// double check if user wants to delete particular table and warn him on data loss
