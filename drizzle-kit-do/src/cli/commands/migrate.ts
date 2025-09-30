
import { Policy, Role, View } from '../../serializer/pgSchema';
import { View as SQLiteView } from '../../serializer/sqliteSchema';
import {
	Column,
	ColumnsResolverInput,
	ColumnsResolverOutput,
	Enum,
	PolicyResolverInput,
	PolicyResolverOutput,
	ResolverInput,
	ResolverOutput,
	ResolverOutputWithMoved,
	RolesResolverInput,
	RolesResolverOutput,
	Sequence,
	Table,
	TablePolicyResolverInput,
	TablePolicyResolverOutput
} from '../../snapshotsDiffer';
import { Journal } from '../../utils';
import { Driver } from '../validations/common';

const chalk = {
	fn: (text: string) => text,
}

const isRenamePromptItem = <T extends Named>(
	item: RenamePropmtItem<T> | T,
): item is RenamePropmtItem<T> => {
	return 'from' in item && 'to' in item;
};

export type Named = {
	name: string;
};

export type NamedWithSchema = {
	name: string;
	schema: string;
};

export const schemasResolver = async (
	input: ResolverInput<Table>,
): Promise<ResolverOutput<Table>> => {
	try {
		const { created, deleted, renamed } = await promptSchemasConflict(
			input.created,
			input.deleted,
		);

		return { created: created, deleted: deleted, renamed: renamed };
	} catch (e) {
		console.error(e);
		throw e;
	}
};

export const tablesResolver = async (
	input: ResolverInput<Table>,
): Promise<ResolverOutputWithMoved<Table>> => {
	try {
		const { created, deleted, moved, renamed } = await promptNamedWithSchemasConflict(
			input.created,
			input.deleted,
			'table',
		);

		return {
			created: created,
			deleted: deleted,
			moved: moved,
			renamed: renamed,
		};
	} catch (e) {
		console.error(e);
		throw e;
	}
};

export const viewsResolver = async (
	input: ResolverInput<View>,
): Promise<ResolverOutputWithMoved<View>> => {
	try {
		const { created, deleted, moved, renamed } = await promptNamedWithSchemasConflict(
			input.created,
			input.deleted,
			'view',
		);

		return {
			created: created,
			deleted: deleted,
			moved: moved,
			renamed: renamed,
		};
	} catch (e) {
		console.error(e);
		throw e;
	}
};

export const sqliteViewsResolver = async (
	input: ResolverInput<SQLiteView & { schema: '' }>,
): Promise<ResolverOutputWithMoved<SQLiteView>> => {
	try {
		const { created, deleted, moved, renamed } = await promptNamedWithSchemasConflict(
			input.created,
			input.deleted,
			'view',
		);

		return {
			created: created,
			deleted: deleted,
			moved: moved,
			renamed: renamed,
		};
	} catch (e) {
		console.error(e);
		throw e;
	}
};

export const sequencesResolver = async (
	input: ResolverInput<Sequence>,
): Promise<ResolverOutputWithMoved<Sequence>> => {
	try {
		const { created, deleted, moved, renamed } = await promptNamedWithSchemasConflict(
			input.created,
			input.deleted,
			'sequence',
		);

		return {
			created: created,
			deleted: deleted,
			moved: moved,
			renamed: renamed,
		};
	} catch (e) {
		console.error(e);
		throw e;
	}
};

export const roleResolver = async (
	input: RolesResolverInput<Role>,
): Promise<RolesResolverOutput<Role>> => {
	const result = await promptNamedConflict(
		input.created,
		input.deleted,
		'role',
	);
	return {
		created: result.created,
		deleted: result.deleted,
		renamed: result.renamed,
	};
};

export const policyResolver = async (
	input: TablePolicyResolverInput<Policy>,
): Promise<TablePolicyResolverOutput<Policy>> => {
	const result = await promptColumnsConflicts(
		input.tableName,
		input.created,
		input.deleted,
	);
	return {
		tableName: input.tableName,
		schema: input.schema,
		created: result.created,
		deleted: result.deleted,
		renamed: result.renamed,
	};
};

export const indPolicyResolver = async (
	input: PolicyResolverInput<Policy>,
): Promise<PolicyResolverOutput<Policy>> => {
	const result = await promptNamedConflict(
		input.created,
		input.deleted,
		'policy',
	);
	return {
		created: result.created,
		deleted: result.deleted,
		renamed: result.renamed,
	};
};

export const enumsResolver = async (
	input: ResolverInput<Enum>,
): Promise<ResolverOutputWithMoved<Enum>> => {
	try {
		const { created, deleted, moved, renamed } = await promptNamedWithSchemasConflict(
			input.created,
			input.deleted,
			'enum',
		);

		return {
			created: created,
			deleted: deleted,
			moved: moved,
			renamed: renamed,
		};
	} catch (e) {
		console.error(e);
		throw e;
	}
};

export const columnsResolver = async (
	input: ColumnsResolverInput<Column>,
): Promise<ColumnsResolverOutput<Column>> => {
	const result = await promptColumnsConflicts(
		input.tableName,
		input.created,
		input.deleted,
	);
	return {
		tableName: input.tableName,
		schema: input.schema,
		created: result.created,
		deleted: result.deleted,
		renamed: result.renamed,
	};
};

const freeeeeeze = (obj: any) => {
	Object.freeze(obj);
	for (let key in obj) {
		if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
			freeeeeeze(obj[key]);
		}
	}
};

export const promptColumnsConflicts = async <T extends Named>(
	tableName: string,
	newColumns: T[],
	missingColumns: T[],
) => {
	if (newColumns.length === 0 || missingColumns.length === 0) {
		return { created: newColumns, renamed: [], deleted: missingColumns };
	}
	const result: { created: T[]; renamed: { from: T; to: T }[]; deleted: T[] } = {
		created: [],
		renamed: [],
		deleted: [],
	};

	let index = 0;
	let leftMissing = [...missingColumns];

	do {
		const created = newColumns[index];

		const renames: RenamePropmtItem<T>[] = leftMissing.map((it) => {
			return { from: it, to: created };
		});

		const promptData: (RenamePropmtItem<T> | T)[] = [created, ...renames];
		if (promptData.length > 1) {
			console.log('promptColumnsConflicts: ', ...promptData);
		}
		const data = promptData[0];

		if (isRenamePromptItem(data)) {

			result.renamed.push(data);
			// this will make [item1, undefined, item2]
			delete leftMissing[leftMissing.indexOf(data.from)];
			// this will make [item1, item2]
			leftMissing = leftMissing.filter(Boolean);
		} else {
			result.created.push(created);
		}
		index += 1;
	} while (index < newColumns.length);
	console.log(
		chalk.fn(`--- all columns conflicts in ${tableName} table resolved ---\n`),
	);

	result.deleted.push(...leftMissing);
	return result;
};

export const promptNamedConflict = async <T extends Named>(
	newItems: T[],
	missingItems: T[],
	entity: 'role' | 'policy',
): Promise<{
	created: T[];
	renamed: { from: T; to: T }[];
	deleted: T[];
}> => {
	if (missingItems.length === 0 || newItems.length === 0) {
		return {
			created: newItems,
			renamed: [],
			deleted: missingItems,
		};
	}

	const result: {
		created: T[];
		renamed: { from: T; to: T }[];
		deleted: T[];
	} = { created: [], renamed: [], deleted: [] };
	let index = 0;
	let leftMissing = [...missingItems];
	do {
		const created = newItems[index];
		const renames: RenamePropmtItem<T>[] = leftMissing.map((it) => {
			return { from: it, to: created };
		});

		const promptData: (RenamePropmtItem<T> | T)[] = [created, ...renames];
		if (promptData.length > 1) {
			console.log('promptNamedConflict: ', ...promptData);
		}
		const data = promptData[0];

		if (isRenamePromptItem(data)) {
			console.log(
				`${chalk.fn('~')} ${data.from.name} › ${data.to.name} ${chalk.fn(
					`${entity} will be renamed/moved`,
				)
				}`,
			);

			if (data.from.name !== data.to.name) {
				result.renamed.push(data);
			}

			delete leftMissing[leftMissing.indexOf(data.from)];
			leftMissing = leftMissing.filter(Boolean);
		} else {
			console.log(
				`${chalk.fn('+')} ${data.name} ${chalk.fn(
					`${entity} will be created`,
				)
				}`,
			);
			result.created.push(created);
		}
		index += 1;
	} while (index < newItems.length);
	console.log(chalk.fn(`--- all ${entity} conflicts resolved ---\n`));
	result.deleted.push(...leftMissing);
	return result;
};

export const promptNamedWithSchemasConflict = async <T extends NamedWithSchema>(
	newItems: T[],
	missingItems: T[],
	entity: 'table' | 'enum' | 'sequence' | 'view',
): Promise<{
	created: T[];
	renamed: { from: T; to: T }[];
	moved: { name: string; schemaFrom: string; schemaTo: string }[];
	deleted: T[];
}> => {
	if (missingItems.length === 0 || newItems.length === 0) {
		return {
			created: newItems,
			renamed: [],
			moved: [],
			deleted: missingItems,
		};
	}

	const result: {
		created: T[];
		renamed: { from: T; to: T }[];
		moved: { name: string; schemaFrom: string; schemaTo: string }[];
		deleted: T[];
	} = { created: [], renamed: [], moved: [], deleted: [] };
	let index = 0;
	let leftMissing = [...missingItems];
	do {
		const created = newItems[index];
		const renames: RenamePropmtItem<T>[] = leftMissing.map((it) => {
			return { from: it, to: created };
		});

		const promptData: (RenamePropmtItem<T> | T)[] = [created, ...renames];
		if (promptData.length > 1) {
			console.log('promptNamedWithSchemasConflict: ', ...promptData);
		}

		const data = promptData[0];

		if (isRenamePromptItem(data)) {
			const schemaFromPrefix = !data.from.schema || data.from.schema === 'public'
				? ''
				: `${data.from.schema}.`;
			const schemaToPrefix = !data.to.schema || data.to.schema === 'public'
				? ''
				: `${data.to.schema}.`;

			console.log(
				`${chalk.fn('~')} ${schemaFromPrefix}${data.from.name} › ${schemaToPrefix}${data.to.name} ${chalk.fn(
					`${entity} will be renamed/moved`,
				)
				}`,
			);

			if (data.from.name !== data.to.name) {
				result.renamed.push(data);
			}

			if (data.from.schema !== data.to.schema) {
				result.moved.push({
					name: data.from.name,
					schemaFrom: data.from.schema || 'public',
					schemaTo: data.to.schema || 'public',
				});
			}

			delete leftMissing[leftMissing.indexOf(data.from)];
			leftMissing = leftMissing.filter(Boolean);
		} else {
			console.log(
				`${chalk.fn('+')} ${data.name} ${chalk.fn(
					`${entity} will be created`,
				)
				}`,
			);
			result.created.push(created);
		}
		index += 1;
	} while (index < newItems.length);
	console.log(chalk.fn(`--- all ${entity} conflicts resolved ---\n`));
	result.deleted.push(...leftMissing);
	return result;
};

export const promptSchemasConflict = async <T extends Named>(
	newSchemas: T[],
	missingSchemas: T[],
): Promise<{ created: T[]; renamed: { from: T; to: T }[]; deleted: T[] }> => {
	if (missingSchemas.length === 0 || newSchemas.length === 0) {
		return { created: newSchemas, renamed: [], deleted: missingSchemas };
	}

	const result: { created: T[]; renamed: { from: T; to: T }[]; deleted: T[] } = {
		created: [],
		renamed: [],
		deleted: [],
	};
	let index = 0;
	let leftMissing = [...missingSchemas];
	do {
		const created = newSchemas[index];
		const renames: RenamePropmtItem<T>[] = leftMissing.map((it) => {
			return { from: it, to: created };
		});

		const promptData: (RenamePropmtItem<T> | T)[] = [created, ...renames];
		if (promptData.length > 1) {
			console.log('promptSchemasConflict: ', ...promptData);
		}
		const data = promptData[0];

		if (isRenamePromptItem(data)) {
			console.log(
				`${chalk.fn('~')} ${data.from.name} › ${data.to.name} ${chalk.fn(
					'schema will be renamed',
				)
				}`,
			);
			result.renamed.push(data);
			delete leftMissing[leftMissing.indexOf(data.from)];
			leftMissing = leftMissing.filter(Boolean);
		} else {
			console.log(
				`${chalk.fn('+')} ${data.name} ${chalk.fn(
					'schema will be created',
				)
				}`,
			);
			result.created.push(created);
		}
		index += 1;
	} while (index < newSchemas.length);
	console.log(chalk.fn('--- all schemas conflicts resolved ---\n'));
	result.deleted.push(...leftMissing);
	return result;
};

export const BREAKPOINT = '--> statement-breakpoint\n';

export const embeddedMigrations = (journal: Journal, driver?: Driver) => {
	let content = driver === 'expo'
		? '// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo\n\n'
		: '';

	content += "import journal from './meta/_journal.json';\n";
	journal.entries.forEach((entry) => {
		content += `import m${entry.idx.toString().padStart(4, '0')} from './${entry.tag}.sql';\n`;
	});

	content += `
  export default {
    journal,
    migrations: {
      ${journal.entries
			.map((it) => `m${it.idx.toString().padStart(4, '0')}`)
			.join(',\n')
		}
    }
  }
  `;
	return content;
};

export const prepareSnapshotFolderName = () => {
	const now = new Date();
	return `${now.getFullYear()}${two(now.getUTCMonth() + 1)}${two(
		now.getUTCDate(),
	)
		}${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(
			now.getUTCSeconds(),
		)
		}`;
};

const two = (input: number): string => {
	return input.toString().padStart(2, '0');
};
