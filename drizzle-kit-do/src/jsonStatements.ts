import { getNewTableName } from './cli/commands/sqlitePushUtils';
import { CommonSquashedSchema } from './schemaValidator';
import { PgSquasher } from './serializer/pgSchema';
import {
	SQLiteKitInternals,
	SQLiteSchemaInternal,
	SQLiteSchemaSquashed,
	SQLiteSquasher,
} from './serializer/sqliteSchema';
import { AlteredColumn, Column, Table } from './snapshotsDiffer';

export const prepareSQLiteCreateTable = (
	table: Table,
	action?: 'push' | undefined,
): JsonSqliteCreateTableStatement => {
	const { name, columns, uniqueConstraints, checkConstraints } = table;

	const references: string[] = Object.values(table.foreignKeys);

	const composites: string[][] = Object.values(table.compositePrimaryKeys).map(
		(it) => SQLiteSquasher.unsquashPK(it),
	);

	const fks = references.map((it) =>
		action === 'push'
			? SQLiteSquasher.unsquashPushFK(it)
			: SQLiteSquasher.unsquashFK(it)
	);

	return {
		type: 'sqlite_create_table',
		tableName: name,
		columns: Object.values(columns),
		referenceData: fks,
		compositePKs: composites,
		uniqueConstraints: Object.values(uniqueConstraints),
		checkConstraints: Object.values(checkConstraints),
	};
};

export const prepareDropTableJson = (table: Table): JsonDropTableStatement => {
	return {
		type: 'drop_table',
		tableName: table.name,
		schema: table.schema,
		policies: table.policies ? Object.values(table.policies) : [],
	};
};

export const prepareRenameTableJson = (
	tableFrom: Table,
	tableTo: Table,
): JsonRenameTableStatement => {
	return {
		type: 'rename_table',
		fromSchema: tableTo.schema,
		toSchema: tableTo.schema,
		tableNameFrom: tableFrom.name,
		tableNameTo: tableTo.name,
	};
};

export const prepareCreateEnumJson = (
	name: string,
	schema: string,
	values: string[],
): JsonCreateEnumStatement => {
	return {
		type: 'create_type_enum',
		name: name,
		schema: schema,
		values,
	};
};

// https://blog.yo1.dog/updating-enum-values-in-postgresql-the-safe-and-easy-way/
export const prepareAddValuesToEnumJson = (
	name: string,
	schema: string,
	values: { value: string; before: string }[],
): JsonAddValueToEnumStatement[] => {
	return values.map((it) => {
		return {
			type: 'alter_type_add_value',
			name: name,
			schema: schema,
			value: it.value,
			before: it.before,
		};
	});
};

export const prepareDropEnumValues = (
	name: string,
	schema: string,
	removedValues: string[],
	json2: PgSchema,
): JsonDropValueFromEnumStatement[] => {
	if (!removedValues.length) return [];

	const affectedColumns: JsonDropValueFromEnumStatement['columnsWithEnum'] = [];

	for (const tableKey in json2.tables) {
		const table = json2.tables[tableKey];
		for (const columnKey in table.columns) {
			const column = table.columns[columnKey];

			const arrayDefinitionRegex = /\[\d*(?:\[\d*\])*\]/g;
			const parsedColumnType = column.type.replace(arrayDefinitionRegex, '');

			if (parsedColumnType === name && column.typeSchema === schema) {
				affectedColumns.push({
					tableSchema: table.schema,
					table: table.name,
					column: column.name,
					columnType: column.type,
					default: column.default,
				});
			}
		}
	}

	return [{
		type: 'alter_type_drop_value',
		name: name,
		enumSchema: schema,
		deletedValues: removedValues,
		newValues: json2.enums[`${schema}.${name}`].values,
		columnsWithEnum: affectedColumns,
	}];
};

export const prepareDropEnumJson = (
	name: string,
	schema: string,
): JsonDropEnumStatement => {
	return {
		type: 'drop_type_enum',
		name: name,
		schema: schema,
	};
};

export const prepareMoveEnumJson = (
	name: string,
	schemaFrom: string,
	schemaTo: string,
): JsonMoveEnumStatement => {
	return {
		type: 'move_type_enum',
		name: name,
		schemaFrom,
		schemaTo,
	};
};

export const prepareRenameEnumJson = (
	nameFrom: string,
	nameTo: string,
	schema: string,
): JsonRenameEnumStatement => {
	return {
		type: 'rename_type_enum',
		nameFrom,
		nameTo,
		schema,
	};
};

////////////

export const prepareRenameColumns = (
	tableName: string,
	// TODO: split for pg and mysql+sqlite and singlestore without schema
	schema: string,
	pairs: { from: Column; to: Column }[],
): JsonRenameColumnStatement[] => {
	return pairs.map((it) => {
		return {
			type: 'alter_table_rename_column',
			tableName: tableName,
			oldColumnName: it.from.name,
			newColumnName: it.to.name,
			schema,
		};
	});
};

export const _prepareDropColumns = (
	taleName: string,
	schema: string,
	columns: Column[],
): JsonDropColumnStatement[] => {
	return columns.map((it) => {
		return {
			type: 'alter_table_drop_column',
			tableName: taleName,
			columnName: it.name,
			schema,
		};
	});
};

export const _prepareAddColumns = (
	tableName: string,
	schema: string,
	columns: Column[],
): JsonAddColumnStatement[] => {
	return columns.map((it) => {
		return {
			type: 'alter_table_add_column',
			tableName: tableName,
			column: it,
			schema,
		};
	});
};

export const _prepareSqliteAddColumns = (
	tableName: string,
	columns: Column[],
	referenceData: string[],
): JsonSqliteAddColumnStatement[] => {
	const unsquashed = referenceData.map((addedFkValue) => SQLiteSquasher.unsquashFK(addedFkValue));

	return columns
		.map((it) => {
			const columnsWithReference = unsquashed.find((t) => t.columnsFrom.includes(it.name));

			if (it.generated?.type === 'stored') {
				console.warn(
					`As SQLite docs mention: "It is not possible to ALTER TABLE ADD COLUMN a STORED column. One can add a VIRTUAL column, however", source: "https://www.sqlite.org/gencol.html"`,
				);
				return undefined;
			}

			return {
				type: 'sqlite_alter_table_add_column',
				tableName: tableName,
				column: it,
				referenceData: columnsWithReference
					? SQLiteSquasher.squashFK(columnsWithReference)
					: undefined,
			};
		})
		.filter(Boolean) as JsonSqliteAddColumnStatement[];
};

export const prepareSqliteAlterColumns = (
	tableName: string,
	schema: string,
	columns: AlteredColumn[],
	// TODO: remove?
	json2: CommonSquashedSchema,
): JsonAlterColumnStatement[] => {
	let statements: JsonAlterColumnStatement[] = [];
	let dropPkStatements: JsonAlterColumnDropPrimaryKeyStatement[] = [];
	let setPkStatements: JsonAlterColumnSetPrimaryKeyStatement[] = [];

	for (const column of columns) {
		const columnName = typeof column.name !== 'string' ? column.name.new : column.name;

		// I used any, because those fields are available only for mysql dialect
		// For other dialects it will become undefined, that is fine for json statements
		const columnType = json2.tables[tableName].columns[columnName].type;
		const columnDefault = json2.tables[tableName].columns[columnName].default;
		const columnOnUpdate = (json2.tables[tableName].columns[columnName] as any)
			.onUpdate;
		const columnNotNull = json2.tables[tableName].columns[columnName].notNull;
		const columnAutoIncrement = (
			json2.tables[tableName].columns[columnName] as any
		).autoincrement;
		const columnPk = (json2.tables[tableName].columns[columnName] as any)
			.primaryKey;

		const columnGenerated = json2.tables[tableName].columns[columnName].generated;

		const compositePk = json2.tables[tableName].compositePrimaryKeys[
			`${tableName}_${columnName}`
		];

		if (column.autoincrement?.type === 'added') {
			statements.push({
				type: 'alter_table_alter_column_set_autoincrement',
				tableName,
				columnName,
				schema,
				newDataType: columnType,
				columnDefault,
				columnOnUpdate,
				columnNotNull,
				columnAutoIncrement,
				columnPk,
			});
		}

		if (column.autoincrement?.type === 'changed') {
			const type = column.autoincrement.new
				? 'alter_table_alter_column_set_autoincrement'
				: 'alter_table_alter_column_drop_autoincrement';

			statements.push({
				type,
				tableName,
				columnName,
				schema,
				newDataType: columnType,
				columnDefault,
				columnOnUpdate,
				columnNotNull,
				columnAutoIncrement,
				columnPk,
			});
		}

		if (column.autoincrement?.type === 'deleted') {
			statements.push({
				type: 'alter_table_alter_column_drop_autoincrement',
				tableName,
				columnName,
				schema,
				newDataType: columnType,
				columnDefault,
				columnOnUpdate,
				columnNotNull,
				columnAutoIncrement,
				columnPk,
			});
		}

		if (typeof column.name !== 'string') {
			statements.push({
				type: 'alter_table_rename_column',
				tableName,
				oldColumnName: column.name.old,
				newColumnName: column.name.new,
				schema,
			});
		}

		if (column.type?.type === 'changed') {
			statements.push({
				type: 'alter_table_alter_column_set_type',
				tableName,
				columnName,
				newDataType: column.type.new,
				oldDataType: column.type.old,
				schema,
				columnDefault,
				columnOnUpdate,
				columnNotNull,
				columnAutoIncrement,
				columnPk,
			});
		}

		if (
			column.primaryKey?.type === 'deleted'
			|| (column.primaryKey?.type === 'changed'
				&& !column.primaryKey.new
				&& typeof compositePk === 'undefined')
		) {
			dropPkStatements.push({
				////
				type: 'alter_table_alter_column_drop_pk',
				tableName,
				columnName,
				schema,
			});
		}

		if (column.default?.type === 'added') {
			statements.push({
				type: 'alter_table_alter_column_set_default',
				tableName,
				columnName,
				newDefaultValue: column.default.value,
				schema,
				columnOnUpdate,
				columnNotNull,
				columnAutoIncrement,
				newDataType: columnType,
				columnPk,
			});
		}

		if (column.default?.type === 'changed') {
			statements.push({
				type: 'alter_table_alter_column_set_default',
				tableName,
				columnName,
				newDefaultValue: column.default.new,
				oldDefaultValue: column.default.old,
				schema,
				columnOnUpdate,
				columnNotNull,
				columnAutoIncrement,
				newDataType: columnType,
				columnPk,
			});
		}

		if (column.default?.type === 'deleted') {
			statements.push({
				type: 'alter_table_alter_column_drop_default',
				tableName,
				columnName,
				schema,
				columnDefault,
				columnOnUpdate,
				columnNotNull,
				columnAutoIncrement,
				newDataType: columnType,
				columnPk,
			});
		}

		if (column.notNull?.type === 'added') {
			statements.push({
				type: 'alter_table_alter_column_set_notnull',
				tableName,
				columnName,
				schema,
				newDataType: columnType,
				columnDefault,
				columnOnUpdate,
				columnNotNull,
				columnAutoIncrement,
				columnPk,
			});
		}

		if (column.notNull?.type === 'changed') {
			const type = column.notNull.new
				? 'alter_table_alter_column_set_notnull'
				: 'alter_table_alter_column_drop_notnull';
			statements.push({
				type: type,
				tableName,
				columnName,
				schema,
				newDataType: columnType,
				columnDefault,
				columnOnUpdate,
				columnNotNull,
				columnAutoIncrement,
				columnPk,
			});
		}

		if (column.notNull?.type === 'deleted') {
			statements.push({
				type: 'alter_table_alter_column_drop_notnull',
				tableName,
				columnName,
				schema,
				newDataType: columnType,
				columnDefault,
				columnOnUpdate,
				columnNotNull,
				columnAutoIncrement,
				columnPk,
			});
		}

		if (column.generated?.type === 'added') {
			if (columnGenerated?.type === 'virtual') {
				statements.push({
					type: 'alter_table_alter_column_set_generated',
					tableName,
					columnName,
					schema,
					newDataType: columnType,
					columnDefault,
					columnOnUpdate,
					columnNotNull,
					columnAutoIncrement,
					columnPk,
					columnGenerated,
				});
			} else {
				console.warn(
					`As SQLite docs mention: "It is not possible to ALTER TABLE ADD COLUMN a STORED column. One can add a VIRTUAL column, however", source: "https://www.sqlite.org/gencol.html"`,
				);
			}
		}

		if (column.generated?.type === 'changed') {
			if (columnGenerated?.type === 'virtual') {
				statements.push({
					type: 'alter_table_alter_column_alter_generated',
					tableName,
					columnName,
					schema,
					newDataType: columnType,
					columnDefault,
					columnOnUpdate,
					columnNotNull,
					columnAutoIncrement,
					columnPk,
					columnGenerated,
				});
			} else {
				console.warn(
					`As SQLite docs mention: "It is not possible to ALTER TABLE ADD COLUMN a STORED column. One can add a VIRTUAL column, however", source: "https://www.sqlite.org/gencol.html"`,
				);
			}
		}

		if (column.generated?.type === 'deleted') {
			statements.push({
				type: 'alter_table_alter_column_drop_generated',
				tableName,
				columnName,
				schema,
				newDataType: columnType,
				columnDefault,
				columnOnUpdate,
				columnNotNull,
				columnAutoIncrement,
				columnPk,
				columnGenerated,
			});
		}

		if (
			column.primaryKey?.type === 'added'
			|| (column.primaryKey?.type === 'changed' && column.primaryKey.new)
		) {
			const wasAutoincrement = statements.filter(
				(it) => it.type === 'alter_table_alter_column_set_autoincrement',
			);
			if (wasAutoincrement.length === 0) {
				setPkStatements.push({
					type: 'alter_table_alter_column_set_pk',
					tableName,
					schema,
					columnName,
				});
			}
		}

		if (column.onUpdate?.type === 'added') {
			statements.push({
				type: 'alter_table_alter_column_set_on_update',
				tableName,
				columnName,
				schema,
				newDataType: columnType,
				columnDefault,
				columnOnUpdate,
				columnNotNull,
				columnAutoIncrement,
				columnPk,
			});
		}

		if (column.onUpdate?.type === 'deleted') {
			statements.push({
				type: 'alter_table_alter_column_drop_on_update',
				tableName,
				columnName,
				schema,
				newDataType: columnType,
				columnDefault,
				columnOnUpdate,
				columnNotNull,
				columnAutoIncrement,
				columnPk,
			});
		}
	}

	return [...dropPkStatements, ...setPkStatements, ...statements];
};

export const preparePgCreateIndexesJson = (
	tableName: string,
	schema: string,
	indexes: Record<string, string>,
	fullSchema: PgSchema,
	action?: 'push' | undefined,
): JsonPgCreateIndexStatement[] => {
	if (action === 'push') {
		return Object.values(indexes).map((indexData) => {
			const unsquashedIndex = PgSquasher.unsquashIdxPush(indexData);
			const data = fullSchema.tables[`${schema === '' ? 'public' : schema}.${tableName}`]
				.indexes[unsquashedIndex.name];
			return {
				type: 'create_index_pg',
				tableName,
				data,
				schema,
			};
		});
	}
	return Object.values(indexes).map((indexData) => {
		return {
			type: 'create_index_pg',
			tableName,
			data: PgSquasher.unsquashIdx(indexData),
			schema,
		};
	});
};

export const prepareCreateIndexesJson = (
	tableName: string,
	schema: string,
	indexes: Record<string, string>,
	internal?: MySqlKitInternals | SQLiteKitInternals,
): JsonCreateIndexStatement[] => {
	return Object.values(indexes).map((indexData) => {
		return {
			type: 'create_index',
			tableName,
			data: indexData,
			schema,
			internal,
		};
	});
};

export const prepareCreateReferencesJson = (
	tableName: string,
	schema: string,
	foreignKeys: Record<string, string>,
): JsonCreateReferenceStatement[] => {
	return Object.values(foreignKeys).map((fkData) => {
		return {
			type: 'create_reference',
			tableName,
			data: fkData,
			schema,
		};
	});
};
export const prepareLibSQLCreateReferencesJson = (
	tableName: string,
	schema: string,
	foreignKeys: Record<string, string>,
	json2: SQLiteSchemaSquashed,
	action?: 'push',
): JsonCreateReferenceStatement[] => {
	return Object.values(foreignKeys).map((fkData) => {
		const { columnsFrom, tableFrom, columnsTo } = action === 'push'
			? SQLiteSquasher.unsquashPushFK(fkData)
			: SQLiteSquasher.unsquashFK(fkData);

		// When trying to alter table in lib sql it is necessary to pass all config for column like "NOT NULL", "DEFAULT", etc.
		// If it is multicolumn reference it is not possible to pass this data for all columns
		// Pass multicolumn flag for sql statements to not generate migration
		let isMulticolumn = false;

		if (columnsFrom.length > 1 || columnsTo.length > 1) {
			isMulticolumn = true;

			return {
				type: 'create_reference',
				tableName,
				data: fkData,
				schema,
				isMulticolumn,
			};
		}

		const columnFrom = columnsFrom[0];

		const {
			notNull: columnNotNull,
			default: columnDefault,
			type: columnType,
		} = json2.tables[tableFrom].columns[columnFrom];

		return {
			type: 'create_reference',
			tableName,
			data: fkData,
			schema,
			columnNotNull,
			columnDefault,
			columnType,
		};
	});
};

export const prepareDropReferencesJson = (
	tableName: string,
	schema: string,
	foreignKeys: Record<string, string>,
): JsonDeleteReferenceStatement[] => {
	return Object.values(foreignKeys).map((fkData) => {
		return {
			type: 'delete_reference',
			tableName,
			data: fkData,
			schema,
		};
	});
};
export const prepareLibSQLDropReferencesJson = (
	tableName: string,
	schema: string,
	foreignKeys: Record<string, string>,
	json2: SQLiteSchemaSquashed,
	meta: SQLiteSchemaInternal['_meta'],
	action?: 'push',
): JsonDeleteReferenceStatement[] => {
	const statements = Object.values(foreignKeys).map((fkData) => {
		const { columnsFrom, tableFrom, columnsTo, name, tableTo, onDelete, onUpdate } = action === 'push'
			? SQLiteSquasher.unsquashPushFK(fkData)
			: SQLiteSquasher.unsquashFK(fkData);

		// If all columns from where were references were deleted -> skip this logic
		// Drop columns will cover this scenario
		const keys = Object.keys(json2.tables[tableName].columns);
		const filtered = columnsFrom.filter((it) => keys.includes(it));
		const fullDrop = filtered.length === 0;
		if (fullDrop) return;

		// When trying to alter table in lib sql it is necessary to pass all config for column like "NOT NULL", "DEFAULT", etc.
		// If it is multicolumn reference it is not possible to pass this data for all columns
		// Pass multicolumn flag for sql statements to not generate migration
		let isMulticolumn = false;

		if (columnsFrom.length > 1 || columnsTo.length > 1) {
			isMulticolumn = true;

			return {
				type: 'delete_reference',
				tableName,
				data: fkData,
				schema,
				isMulticolumn,
			};
		}

		const columnFrom = columnsFrom[0];
		const newTableName = getNewTableName(tableFrom, meta);

		const {
			notNull: columnNotNull,
			default: columnDefault,
			type: columnType,
		} = json2.tables[newTableName].columns[columnFrom];

		const fkToSquash = {
			columnsFrom,
			columnsTo,
			name,
			tableFrom: newTableName,
			tableTo,
			onDelete,
			onUpdate,
		};
		const foreignKey = action === 'push'
			? SQLiteSquasher.squashPushFK(fkToSquash)
			: SQLiteSquasher.squashFK(fkToSquash);
		return {
			type: 'delete_reference',
			tableName,
			data: foreignKey,
			schema,
			columnNotNull,
			columnDefault,
			columnType,
		};
	});

	return statements.filter((it) => it) as JsonDeleteReferenceStatement[];
};

// alter should create 2 statements. It's important to make only 1 sql per statement(for breakpoints)
export const prepareAlterReferencesJson = (
	tableName: string,
	schema: string,
	foreignKeys: Record<string, { __old: string; __new: string }>,
): JsonReferenceStatement[] => {
	const stmts: JsonReferenceStatement[] = [];
	Object.values(foreignKeys).map((val) => {
		stmts.push({
			type: 'delete_reference',
			tableName,
			schema,
			data: val.__old,
		});

		stmts.push({
			type: 'create_reference',
			tableName,
			schema,
			data: val.__new,
		});
	});
	return stmts;
};

export const prepareDropIndexesJson = (
	tableName: string,
	schema: string,
	indexes: Record<string, string>,
): JsonDropIndexStatement[] => {
	return Object.values(indexes).map((indexData) => {
		return {
			type: 'drop_index',
			tableName,
			data: indexData,
			schema,
		};
	});
};

export const prepareAddCompositePrimaryKeySqlite = (
	tableName: string,
	pks: Record<string, string>,
): JsonCreateCompositePK[] => {
	return Object.values(pks).map((it) => {
		return {
			type: 'create_composite_pk',
			tableName,
			data: it,
		} as JsonCreateCompositePK;
	});
};

export const prepareDeleteCompositePrimaryKeySqlite = (
	tableName: string,
	pks: Record<string, string>,
): JsonDeleteCompositePK[] => {
	return Object.values(pks).map((it) => {
		return {
			type: 'delete_composite_pk',
			tableName,
			data: it,
		} as JsonDeleteCompositePK;
	});
};

export const prepareAlterCompositePrimaryKeySqlite = (
	tableName: string,
	pks: Record<string, { __old: string; __new: string }>,
): JsonAlterCompositePK[] => {
	return Object.values(pks).map((it) => {
		return {
			type: 'alter_composite_pk',
			tableName,
			old: it.__old,
			new: it.__new,
		} as JsonAlterCompositePK;
	});
};

export const prepareAddUniqueConstraintPg = (
	tableName: string,
	schema: string,
	unqs: Record<string, string>,
): JsonCreateUniqueConstraint[] => {
	return Object.values(unqs).map((it) => {
		return {
			type: 'create_unique_constraint',
			tableName,
			data: it,
			schema,
		} as JsonCreateUniqueConstraint;
	});
};


export const prepareDeleteUniqueConstraintPg = (
	tableName: string,
	schema: string,
	unqs: Record<string, string>,
): JsonDeleteUniqueConstraint[] => {
	return Object.values(unqs).map((it) => {
		return {
			type: 'delete_unique_constraint',
			tableName,
			data: it,
			schema,
		} as JsonDeleteUniqueConstraint;
	});
};

export const prepareAddCheckConstraint = (
	tableName: string,
	schema: string,
	check: Record<string, string>,
): JsonCreateCheckConstraint[] => {
	return Object.values(check).map((it) => {
		return {
			type: 'create_check_constraint',
			tableName,
			data: it,
			schema,
		} as JsonCreateCheckConstraint;
	});
};

export const prepareDeleteCheckConstraint = (
	tableName: string,
	schema: string,
	check: Record<string, string>,
): JsonDeleteCheckConstraint[] => {
	return Object.values(check).map((it) => {
		return {
			type: 'delete_check_constraint',
			tableName,
			constraintName: PgSquasher.unsquashCheck(it).name,
			schema,
		} as JsonDeleteCheckConstraint;
	});
};

export const prepareSqliteCreateViewJson = (
	name: string,
	definition: string,
): JsonCreateSqliteViewStatement => {
	return {
		type: 'sqlite_create_view',
		name: name,
		definition: definition,
	};
};

export const prepareDropViewJson = (
	name: string,
	schema?: string,
	materialized?: boolean,
): JsonDropViewStatement => {
	const resObject: JsonDropViewStatement = <JsonDropViewStatement> { name, type: 'drop_view' };

	if (schema) resObject['schema'] = schema;

	if (materialized) resObject['materialized'] = materialized;

	return resObject;
};

export const prepareRenameViewJson = (
	to: string,
	from: string,
	schema?: string,
	materialized?: boolean,
): JsonRenameViewStatement => {
	const resObject: JsonRenameViewStatement = <JsonRenameViewStatement> {
		type: 'rename_view',
		nameTo: to,
		nameFrom: from,
	};

	if (schema) resObject['schema'] = schema;
	if (materialized) resObject['materialized'] = materialized;

	return resObject;
};
