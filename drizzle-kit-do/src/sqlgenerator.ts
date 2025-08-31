import { Dialect } from 'drizzle-orm';
import { SQLiteSchemaSquashed, SQLiteSquasher } from './serializer/sqliteSchema';
import { escapeSingleQuotes } from './utils';
import { PgSquasher } from './serializer/pgSchema';

const parseType = (schemaPrefix: string, type: string) => {
	const pgNativeTypes = [
		'uuid',
		'smallint',
		'integer',
		'bigint',
		'boolean',
		'text',
		'varchar',
		'serial',
		'bigserial',
		'decimal',
		'numeric',
		'real',
		'json',
		'jsonb',
		'time',
		'time with time zone',
		'time without time zone',
		'time',
		'timestamp',
		'timestamp with time zone',
		'timestamp without time zone',
		'date',
		'interval',
		'bigint',
		'bigserial',
		'double precision',
		'interval year',
		'interval month',
		'interval day',
		'interval hour',
		'interval minute',
		'interval second',
		'interval year to month',
		'interval day to hour',
		'interval day to minute',
		'interval day to second',
		'interval hour to minute',
		'interval hour to second',
		'interval minute to second',
		'char',
		'vector',
		'geometry',
		'halfvec',
		'sparsevec',
		'bit',
	];
	const arrayDefinitionRegex = /\[\d*(?:\[\d*\])*\]/g;
	const arrayDefinition = (type.match(arrayDefinitionRegex) ?? []).join('');
	const withoutArrayDefinition = type.replace(arrayDefinitionRegex, '');
	return pgNativeTypes.some((it) => type.startsWith(it))
		? `${withoutArrayDefinition}${arrayDefinition}`
		: `${schemaPrefix}"${withoutArrayDefinition}"${arrayDefinition}`;
};

abstract class Convertor {
	abstract can(
		statement: JsonStatement,
		dialect: Dialect,
	): boolean;
	abstract convert(
		statement: JsonStatement,
		json2?: SQLiteSchemaSquashed,
		action?: 'push',
	): string | string[];
}

export class SQLiteCreateTableConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return statement.type === 'sqlite_create_table' && (dialect === 'sqlite' || dialect === 'turso');
	}

	convert(st: JsonSqliteCreateTableStatement) {
		const {
			tableName,
			columns,
			referenceData,
			compositePKs,
			uniqueConstraints,
			checkConstraints,
		} = st;

		let statement = '';
		statement += `CREATE TABLE \`${tableName}\` (\n`;
		for (let i = 0; i < columns.length; i++) {
			const column = columns[i];

			const primaryKeyStatement = column.primaryKey ? ' PRIMARY KEY' : '';
			const notNullStatement = column.notNull ? ' NOT NULL' : '';
			const defaultStatement = column.default !== undefined ? ` DEFAULT ${column.default}` : '';

			const autoincrementStatement = column.autoincrement
				? ' AUTOINCREMENT'
				: '';

			const generatedStatement = column.generated
				? ` GENERATED ALWAYS AS ${column.generated.as} ${column.generated.type.toUpperCase()}`
				: '';

			statement += '\t';
			statement +=
				`\`${column.name}\` ${column.type}${primaryKeyStatement}${autoincrementStatement}${defaultStatement}${generatedStatement}${notNullStatement}`;

			statement += i === columns.length - 1 ? '' : ',\n';
		}

		compositePKs.forEach((it) => {
			statement += ',\n\t';
			statement += `PRIMARY KEY(${it.map((it) => `\`${it}\``).join(', ')})`;
		});

		for (let i = 0; i < referenceData.length; i++) {
			const {
				name,
				tableFrom,
				tableTo,
				columnsFrom,
				columnsTo,
				onDelete,
				onUpdate,
			} = referenceData[i];

			const onDeleteStatement = onDelete ? ` ON DELETE ${onDelete}` : '';
			const onUpdateStatement = onUpdate ? ` ON UPDATE ${onUpdate}` : '';
			const fromColumnsString = columnsFrom.map((it) => `\`${it}\``).join(',');
			const toColumnsString = columnsTo.map((it) => `\`${it}\``).join(',');

			statement += ',';
			statement += '\n\t';
			statement +=
				`FOREIGN KEY (${fromColumnsString}) REFERENCES \`${tableTo}\`(${toColumnsString})${onUpdateStatement}${onDeleteStatement}`;
		}

		if (
			typeof uniqueConstraints !== 'undefined'
			&& uniqueConstraints.length > 0
		) {
			for (const uniqueConstraint of uniqueConstraints) {
				statement += ',\n';
				const unsquashedUnique = SQLiteSquasher.unsquashUnique(uniqueConstraint);
				statement += `\tCONSTRAINT ${unsquashedUnique.name} UNIQUE(\`${unsquashedUnique.columns.join(`\`,\``)}\`)`;
			}
		}

		if (
			typeof checkConstraints !== 'undefined'
			&& checkConstraints.length > 0
		) {
			for (const check of checkConstraints) {
				statement += ',\n';
				const { value, name } = SQLiteSquasher.unsquashCheck(check);
				statement += `\tCONSTRAINT "${name}" CHECK(${value})`;
			}
		}

		statement += `\n`;
		statement += `);`;
		statement += `\n`;
		return statement;
	}
}

class SqliteCreateViewConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return statement.type === 'sqlite_create_view' && (dialect === 'sqlite' || dialect === 'turso');
	}

	convert(st: JsonCreateSqliteViewStatement) {
		const { definition, name } = st;

		return `CREATE VIEW \`${name}\` AS ${definition};`;
	}
}

class SqliteDropViewConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return statement.type === 'drop_view' && (dialect === 'sqlite' || dialect === 'turso');
	}

	convert(st: JsonDropViewStatement) {
		const { name } = st;

		return `DROP VIEW \`${name}\`;`;
	}
}


class CreateTypeEnumConvertor extends Convertor {
	can(statement: JsonStatement): boolean {
		return statement.type === 'create_type_enum';
	}

	convert(st: JsonCreateEnumStatement) {
		const { name, values, schema } = st;

		const enumNameWithSchema = schema ? `"${schema}"."${name}"` : `"${name}"`;

		let valuesStatement = '(';
		valuesStatement += values.map((it) => `'${escapeSingleQuotes(it)}'`).join(', ');
		valuesStatement += ')';

		// TODO do we need this?
		// let statement = 'DO $$ BEGIN';
		// statement += '\n';
		let statement = `CREATE TYPE ${enumNameWithSchema} AS ENUM${valuesStatement};`;
		// statement += '\n';
		// statement += 'EXCEPTION';
		// statement += '\n';
		// statement += ' WHEN duplicate_object THEN null;';
		// statement += '\n';
		// statement += 'END $$;';
		// statement += '\n';
		return statement;
	}
}

class DropTypeEnumConvertor extends Convertor {
	can(statement: JsonStatement): boolean {
		return statement.type === 'drop_type_enum';
	}

	convert(st: JsonDropEnumStatement) {
		const { name, schema } = st;

		const enumNameWithSchema = schema ? `"${schema}"."${name}"` : `"${name}"`;

		let statement = `DROP TYPE ${enumNameWithSchema};`;

		return statement;
	}
}

class AlterTypeAddValueConvertor extends Convertor {
	can(statement: JsonStatement): boolean {
		return statement.type === 'alter_type_add_value';
	}

	convert(st: JsonAddValueToEnumStatement) {
		const { name, schema, value, before } = st;

		const enumNameWithSchema = schema ? `"${schema}"."${name}"` : `"${name}"`;

		return `ALTER TYPE ${enumNameWithSchema} ADD VALUE '${value}'${before.length ? ` BEFORE '${before}'` : ''};`;
	}
}

class AlterTypeSetSchemaConvertor extends Convertor {
	can(statement: JsonStatement): boolean {
		return statement.type === 'move_type_enum';
	}

	convert(st: JsonMoveEnumStatement) {
		const { name, schemaFrom, schemaTo } = st;

		const enumNameWithSchema = schemaFrom ? `"${schemaFrom}"."${name}"` : `"${name}"`;

		return `ALTER TYPE ${enumNameWithSchema} SET SCHEMA "${schemaTo}";`;
	}
}

class AlterRenameTypeConvertor extends Convertor {
	can(statement: JsonStatement): boolean {
		return statement.type === 'rename_type_enum';
	}

	convert(st: JsonRenameEnumStatement) {
		const { nameTo, nameFrom, schema } = st;

		const enumNameWithSchema = schema ? `"${schema}"."${nameFrom}"` : `"${nameFrom}"`;

		return `ALTER TYPE ${enumNameWithSchema} RENAME TO "${nameTo}";`;
	}
}

class AlterTypeDropValueConvertor extends Convertor {
	can(statement: JsonDropValueFromEnumStatement): boolean {
		return statement.type === 'alter_type_drop_value';
	}

	convert(st: JsonDropValueFromEnumStatement) {
		const { columnsWithEnum, name, newValues, enumSchema } = st;

		const statements: string[] = [];

		for (const withEnum of columnsWithEnum) {
			const tableNameWithSchema = withEnum.tableSchema
				? `"${withEnum.tableSchema}"."${withEnum.table}"`
				: `"${withEnum.table}"`;

			statements.push(
				`ALTER TABLE ${tableNameWithSchema} ALTER COLUMN "${withEnum.column}" SET DATA TYPE text;`,
			);
			if (withEnum.default) {
				statements.push(
					`ALTER TABLE ${tableNameWithSchema} ALTER COLUMN "${withEnum.column}" SET DEFAULT ${withEnum.default}::text;`,
				);
			}
		}

		statements.push(new DropTypeEnumConvertor().convert({ name: name, schema: enumSchema, type: 'drop_type_enum' }));

		statements.push(new CreateTypeEnumConvertor().convert({
			name: name,
			schema: enumSchema,
			values: newValues,
			type: 'create_type_enum',
		}));

		for (const withEnum of columnsWithEnum) {
			const tableNameWithSchema = withEnum.tableSchema
				? `"${withEnum.tableSchema}"."${withEnum.table}"`
				: `"${withEnum.table}"`;

			const parsedType = parseType(`"${enumSchema}".`, withEnum.columnType);
			if (withEnum.default) {
				statements.push(
					`ALTER TABLE ${tableNameWithSchema} ALTER COLUMN "${withEnum.column}" SET DEFAULT ${withEnum.default}::${parsedType};`,
				);
			}

			statements.push(
				`ALTER TABLE ${tableNameWithSchema} ALTER COLUMN "${withEnum.column}" SET DATA TYPE ${parsedType} USING "${withEnum.column}"::${parsedType};`,
			);
		}

		return statements;
	}
}

export class SQLiteDropTableConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return statement.type === 'drop_table' && (dialect === 'sqlite' || dialect === 'turso');
	}

	convert(statement: JsonDropTableStatement) {
		const { tableName } = statement;
		return `DROP TABLE \`${tableName}\`;`;
	}
}

export class SqliteRenameTableConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return statement.type === 'rename_table' && (dialect === 'sqlite' || dialect === 'turso');
	}

	convert(statement: JsonRenameTableStatement) {
		const { tableNameFrom, tableNameTo } = statement;
		return `ALTER TABLE \`${tableNameFrom}\` RENAME TO \`${tableNameTo}\`;`;
	}
}

export class SingleStoreRenameTableConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return statement.type === 'rename_table' && dialect === 'singlestore';
	}

	convert(statement: JsonRenameTableStatement) {
		const { tableNameFrom, tableNameTo } = statement;
		return `ALTER TABLE \`${tableNameFrom}\` RENAME TO \`${tableNameTo}\`;`;
	}
}

class SQLiteAlterTableRenameColumnConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return (
			statement.type === 'alter_table_rename_column' && (dialect === 'sqlite' || dialect === 'turso')
		);
	}

	convert(statement: JsonRenameColumnStatement) {
		const { tableName, oldColumnName, newColumnName } = statement;
		return `ALTER TABLE \`${tableName}\` RENAME COLUMN "${oldColumnName}" TO "${newColumnName}";`;
	}
}


class SQLiteAlterTableDropColumnConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return statement.type === 'alter_table_drop_column' && (dialect === 'sqlite' || dialect === 'turso');
	}

	convert(statement: JsonDropColumnStatement) {
		const { tableName, columnName } = statement;
		return `ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\`;`;
	}
}

export class SQLiteAlterTableAddColumnConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return (
			statement.type === 'sqlite_alter_table_add_column' && (dialect === 'sqlite' || dialect === 'turso')
		);
	}

	convert(statement: JsonSqliteAddColumnStatement) {
		const { tableName, column, referenceData } = statement;
		const { name, type, notNull, primaryKey, generated } = column;

		const defaultStatement = `${column.default !== undefined ? ` DEFAULT ${column.default}` : ''}`;
		const notNullStatement = `${notNull ? ' NOT NULL' : ''}`;
		const primaryKeyStatement = `${primaryKey ? ' PRIMARY KEY' : ''}`;
		const referenceAsObject = referenceData
			? SQLiteSquasher.unsquashFK(referenceData)
			: undefined;
		const referenceStatement = `${
			referenceAsObject
				? ` REFERENCES ${referenceAsObject.tableTo}(${referenceAsObject.columnsTo})`
				: ''
		}`;
		// const autoincrementStatement = `${autoincrement ? 'AUTO_INCREMENT' : ''}`
		const generatedStatement = generated
			? ` GENERATED ALWAYS AS ${generated.as} ${generated.type.toUpperCase()}`
			: '';

		return `ALTER TABLE \`${tableName}\` ADD \`${name}\` ${type}${primaryKeyStatement}${defaultStatement}${generatedStatement}${notNullStatement}${referenceStatement};`;
	}
}

////
class SqliteAlterTableAlterColumnDropGeneratedConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return (
			statement.type === 'alter_table_alter_column_drop_generated'
			&& (dialect === 'sqlite' || dialect === 'turso')
		);
	}

	convert(statement: JsonAlterColumnDropGeneratedStatement) {
		const {
			tableName,
			columnName,
			schema,
			columnDefault,
			columnOnUpdate,
			columnAutoIncrement,
			columnPk,
			columnGenerated,
			columnNotNull,
		} = statement;

		const addColumnStatement = new SQLiteAlterTableAddColumnConvertor().convert(
			{
				tableName,
				column: {
					name: columnName,
					type: statement.newDataType,
					notNull: columnNotNull,
					default: columnDefault,
					onUpdate: columnOnUpdate,
					autoincrement: columnAutoIncrement,
					primaryKey: columnPk,
					generated: columnGenerated,
				},
				type: 'sqlite_alter_table_add_column',
			},
		);

		const dropColumnStatement = new SQLiteAlterTableDropColumnConvertor().convert({
			tableName,
			columnName,
			schema,
			type: 'alter_table_drop_column',
		});

		return [dropColumnStatement, addColumnStatement];
	}
}

class SqliteAlterTableAlterColumnSetExpressionConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return (
			statement.type === 'alter_table_alter_column_set_generated'
			&& (dialect === 'sqlite' || dialect === 'turso')
		);
	}

	convert(statement: JsonAlterColumnSetGeneratedStatement) {
		const {
			tableName,
			columnName,
			schema,
			columnNotNull: notNull,
			columnDefault,
			columnOnUpdate,
			columnAutoIncrement,
			columnPk,
			columnGenerated,
		} = statement;

		const addColumnStatement = new SQLiteAlterTableAddColumnConvertor().convert(
			{
				tableName,
				column: {
					name: columnName,
					type: statement.newDataType,
					notNull,
					default: columnDefault,
					onUpdate: columnOnUpdate,
					autoincrement: columnAutoIncrement,
					primaryKey: columnPk,
					generated: columnGenerated,
				},
				type: 'sqlite_alter_table_add_column',
			},
		);

		const dropColumnStatement = new SQLiteAlterTableDropColumnConvertor().convert({
			tableName,
			columnName,
			schema,
			type: 'alter_table_drop_column',
		});

		return [dropColumnStatement, addColumnStatement];
	}
}

class SqliteAlterTableAlterColumnAlterGeneratedConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return (
			statement.type === 'alter_table_alter_column_alter_generated'
			&& (dialect === 'sqlite' || dialect === 'turso')
		);
	}

	convert(statement: JsonAlterColumnAlterGeneratedStatement) {
		const {
			tableName,
			columnName,
			schema,
			columnNotNull,
			columnDefault,
			columnOnUpdate,
			columnAutoIncrement,
			columnPk,
			columnGenerated,
		} = statement;

		const addColumnStatement = new SQLiteAlterTableAddColumnConvertor().convert(
			{
				tableName,
				column: {
					name: columnName,
					type: statement.newDataType,
					notNull: columnNotNull,
					default: columnDefault,
					onUpdate: columnOnUpdate,
					autoincrement: columnAutoIncrement,
					primaryKey: columnPk,
					generated: columnGenerated,
				},
				type: 'sqlite_alter_table_add_column',
			},
		);

		const dropColumnStatement = new SQLiteAlterTableDropColumnConvertor().convert({
			tableName,
			columnName,
			schema,
			type: 'alter_table_drop_column',
		});

		return [dropColumnStatement, addColumnStatement];
	}
}

////


export class LibSQLModifyColumn extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return (
			(statement.type === 'alter_table_alter_column_set_type'
				|| statement.type === 'alter_table_alter_column_drop_notnull'
				|| statement.type === 'alter_table_alter_column_set_notnull'
				|| statement.type === 'alter_table_alter_column_set_default'
				|| statement.type === 'alter_table_alter_column_drop_default'
				|| statement.type === 'create_check_constraint'
				|| statement.type === 'delete_check_constraint')
			&& dialect === 'turso'
		);
	}

	convert(statement: LibSQLModifyColumnStatement, json2: SQLiteSchemaSquashed) {
		const { tableName, columnName } = statement;

		let columnType = ``;
		let columnDefault: any = '';
		let columnNotNull = '';

		const sqlStatements: string[] = [];

		// collect index info
		const indexes: {
			name: string;
			tableName: string;
			columns: string[];
			isUnique: boolean;
			where?: string | undefined;
		}[] = [];
		for (const table of Object.values(json2.tables)) {
			for (const index of Object.values(table.indexes)) {
				const unsquashed = SQLiteSquasher.unsquashIdx(index);
				sqlStatements.push(`DROP INDEX "${unsquashed.name}";`);
				indexes.push({ ...unsquashed, tableName: table.name });
			}
		}

		switch (statement.type) {
			case 'alter_table_alter_column_set_type':
				columnType = ` ${statement.newDataType}`;

				columnDefault = statement.columnDefault
					? ` DEFAULT ${statement.columnDefault}`
					: '';

				columnNotNull = statement.columnNotNull ? ` NOT NULL` : '';

				break;
			case 'alter_table_alter_column_drop_notnull':
				columnType = ` ${statement.newDataType}`;

				columnDefault = statement.columnDefault
					? ` DEFAULT ${statement.columnDefault}`
					: '';

				columnNotNull = '';
				break;
			case 'alter_table_alter_column_set_notnull':
				columnType = ` ${statement.newDataType}`;

				columnDefault = statement.columnDefault
					? ` DEFAULT ${statement.columnDefault}`
					: '';

				columnNotNull = ` NOT NULL`;
				break;
			case 'alter_table_alter_column_set_default':
				columnType = ` ${statement.newDataType}`;

				columnDefault = ` DEFAULT ${statement.newDefaultValue}`;

				columnNotNull = statement.columnNotNull ? ` NOT NULL` : '';
				break;
			case 'alter_table_alter_column_drop_default':
				columnType = ` ${statement.newDataType}`;

				columnDefault = '';

				columnNotNull = statement.columnNotNull ? ` NOT NULL` : '';
				break;
		}

		// Seems like getting value from simple json2 shanpshot makes dates be dates
		columnDefault = columnDefault instanceof Date
			? columnDefault.toISOString()
			: columnDefault;

		sqlStatements.push(
			`ALTER TABLE \`${tableName}\` ALTER COLUMN "${columnName}" TO "${columnName}"${columnType}${columnNotNull}${columnDefault};`,
		);

		for (const index of indexes) {
			const indexPart = index.isUnique ? 'UNIQUE INDEX' : 'INDEX';
			const whereStatement = index.where ? ` WHERE ${index.where}` : '';
			const uniqueString = index.columns.map((it) => `\`${it}\``).join(',');
			const tableName = index.tableName;

			sqlStatements.push(
				`CREATE ${indexPart} \`${index.name}\` ON \`${tableName}\` (${uniqueString})${whereStatement};`,
			);
		}

		return sqlStatements;
	}
}


class LibSQLCreateForeignKeyConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return (
			statement.type === 'create_reference'
			&& dialect === 'turso'
		);
	}

	convert(
		statement: JsonCreateReferenceStatement,
		json2?: SQLiteSchemaSquashed,
		action?: 'push',
	): string {
		const { columnsFrom, columnsTo, tableFrom, onDelete, onUpdate, tableTo } = action === 'push'
			? SQLiteSquasher.unsquashPushFK(statement.data)
			: SQLiteSquasher.unsquashFK(statement.data);
		const { columnDefault, columnNotNull, columnType } = statement;

		const onDeleteStatement = onDelete ? ` ON DELETE ${onDelete}` : '';
		const onUpdateStatement = onUpdate ? ` ON UPDATE ${onUpdate}` : '';
		const columnsDefaultValue = columnDefault
			? ` DEFAULT ${columnDefault}`
			: '';
		const columnNotNullValue = columnNotNull ? ` NOT NULL` : '';
		const columnTypeValue = columnType ? ` ${columnType}` : '';

		const columnFrom = columnsFrom[0];
		const columnTo = columnsTo[0];

		return `ALTER TABLE \`${tableFrom}\` ALTER COLUMN "${columnFrom}" TO "${columnFrom}"${columnTypeValue}${columnNotNullValue}${columnsDefaultValue} REFERENCES ${tableTo}(${columnTo})${onDeleteStatement}${onUpdateStatement};`;
	}
}

export class CreateSqliteIndexConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return statement.type === 'create_index' && (dialect === 'sqlite' || dialect === 'turso');
	}

	convert(statement: JsonCreateIndexStatement): string {
		// should be changed
		const { name, columns, isUnique, where } = SQLiteSquasher.unsquashIdx(
			statement.data,
		);
		// // since postgresql 9.5
		const indexPart = isUnique ? 'UNIQUE INDEX' : 'INDEX';
		const whereStatement = where ? ` WHERE ${where}` : '';
		const uniqueString = columns
			.map((it) => {
				return statement.internal?.indexes
					? statement.internal?.indexes[name]?.columns[it]?.isExpression
						? it
						: `\`${it}\``
					: `\`${it}\``;
			})
			.join(',');
		return `CREATE ${indexPart} \`${name}\` ON \`${statement.tableName}\` (${uniqueString})${whereStatement};`;
	}
}

export class SqliteDropIndexConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return statement.type === 'drop_index' && (dialect === 'sqlite' || dialect === 'turso');
	}

	convert(statement: JsonDropIndexStatement): string {
		const { name } = PgSquasher.unsquashIdx(statement.data);
		return `DROP INDEX \`${name}\`;`;
	}
}

class SQLiteRecreateTableConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return (
			statement.type === 'recreate_table' && dialect === 'sqlite'
		);
	}

	convert(statement: JsonRecreateTableStatement): string | string[] {
		const { tableName, columns, compositePKs, referenceData, checkConstraints } = statement;

		const columnNames = columns.map((it) => `"${it.name}"`).join(', ');
		const newTableName = `__new_${tableName}`;

		const sqlStatements: string[] = [];

		sqlStatements.push(`PRAGMA foreign_keys=OFF;`);

		// map all possible variants
		const mappedCheckConstraints: string[] = checkConstraints.map((it) =>
			it.replaceAll(`"${tableName}".`, `"${newTableName}".`).replaceAll(`\`${tableName}\`.`, `\`${newTableName}\`.`)
				.replaceAll(`${tableName}.`, `${newTableName}.`).replaceAll(`'${tableName}'.`, `'${newTableName}'.`)
		);

		// create new table
		sqlStatements.push(
			new SQLiteCreateTableConvertor().convert({
				type: 'sqlite_create_table',
				tableName: newTableName,
				columns,
				referenceData,
				compositePKs,
				checkConstraints: mappedCheckConstraints,
			}),
		);

		// migrate data
		sqlStatements.push(
			`INSERT INTO \`${newTableName}\`(${columnNames}) SELECT ${columnNames} FROM \`${tableName}\`;`,
		);

		// drop table
		sqlStatements.push(
			new SQLiteDropTableConvertor().convert({
				type: 'drop_table',
				tableName: tableName,
				schema: '',
			}),
		);

		// rename table
		sqlStatements.push(
			new SqliteRenameTableConvertor().convert({
				fromSchema: '',
				tableNameFrom: newTableName,
				tableNameTo: tableName,
				toSchema: '',
				type: 'rename_table',
			}),
		);

		sqlStatements.push(`PRAGMA foreign_keys=ON;`);

		return sqlStatements;
	}
}

class LibSQLRecreateTableConvertor extends Convertor {
	can(statement: JsonStatement, dialect: Dialect): boolean {
		return (
			statement.type === 'recreate_table'
			&& dialect === 'turso'
		);
	}

	convert(statement: JsonRecreateTableStatement): string[] {
		const { tableName, columns, compositePKs, referenceData, checkConstraints } = statement;

		const columnNames = columns.map((it) => `"${it.name}"`).join(', ');
		const newTableName = `__new_${tableName}`;

		const sqlStatements: string[] = [];

		const mappedCheckConstraints: string[] = checkConstraints.map((it) =>
			it.replaceAll(`"${tableName}".`, `"${newTableName}".`).replaceAll(`\`${tableName}\`.`, `\`${newTableName}\`.`)
				.replaceAll(`${tableName}.`, `${newTableName}.`).replaceAll(`'${tableName}'.`, `\`${newTableName}\`.`)
		);

		sqlStatements.push(`PRAGMA foreign_keys=OFF;`);

		// create new table
		sqlStatements.push(
			new SQLiteCreateTableConvertor().convert({
				type: 'sqlite_create_table',
				tableName: newTableName,
				columns,
				referenceData,
				compositePKs,
				checkConstraints: mappedCheckConstraints,
			}),
		);

		// migrate data
		sqlStatements.push(
			`INSERT INTO \`${newTableName}\`(${columnNames}) SELECT ${columnNames} FROM \`${tableName}\`;`,
		);

		// drop table
		sqlStatements.push(
			new SQLiteDropTableConvertor().convert({
				type: 'drop_table',
				tableName: tableName,
				schema: '',
			}),
		);

		// rename table
		sqlStatements.push(
			new SqliteRenameTableConvertor().convert({
				fromSchema: '',
				tableNameFrom: newTableName,
				tableNameTo: tableName,
				toSchema: '',
				type: 'rename_table',
			}),
		);

		sqlStatements.push(`PRAGMA foreign_keys=ON;`);

		return sqlStatements;
	}
}


const convertors: Convertor[] = [];
convertors.push(new SQLiteCreateTableConvertor());
convertors.push(new SQLiteRecreateTableConvertor());
convertors.push(new LibSQLRecreateTableConvertor());

convertors.push(new SqliteCreateViewConvertor());
convertors.push(new SqliteDropViewConvertor());

convertors.push(new CreateTypeEnumConvertor());
convertors.push(new DropTypeEnumConvertor());
convertors.push(new AlterTypeAddValueConvertor());
convertors.push(new AlterTypeSetSchemaConvertor());
convertors.push(new AlterRenameTypeConvertor());
convertors.push(new AlterTypeDropValueConvertor());

convertors.push(new SQLiteDropTableConvertor());

convertors.push(new SqliteRenameTableConvertor());

convertors.push(new SQLiteAlterTableRenameColumnConvertor());

convertors.push(new SQLiteAlterTableDropColumnConvertor());

convertors.push(new SQLiteAlterTableAddColumnConvertor());

convertors.push(new CreateSqliteIndexConvertor());

convertors.push(new SqliteDropIndexConvertor());


convertors.push(new SqliteAlterTableAlterColumnDropGeneratedConvertor());
convertors.push(new SqliteAlterTableAlterColumnAlterGeneratedConvertor());
convertors.push(new SqliteAlterTableAlterColumnSetExpressionConvertor());

convertors.push(new LibSQLModifyColumn());

convertors.push(new LibSQLCreateForeignKeyConvertor());

export function fromJson(
	statements: JsonStatement[],
	dialect: Dialect,
	action?: 'push',
	json2?: SQLiteSchemaSquashed,
) {
	const result = statements
		.flatMap((statement) => {
			const filtered = convertors.filter((it) => {
				return it.can(statement, dialect);
			});

			const convertor = filtered.length === 1 ? filtered[0] : undefined;

			if (!convertor) {
				return '';
			}

			return convertor.convert(statement, json2, action);
		})
		.filter((it) => it !== '');
	return result;
}
