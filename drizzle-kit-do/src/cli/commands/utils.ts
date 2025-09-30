import { object, string } from 'zod';
// import { getTablesFilterByExtensions } from '../../extensions/getTablesFilterByExtensions';
import { type Dialect, dialect } from '../../schemaValidator';
// import { prepareFilenames } from '../../serializer';
import {
	CasingType,
	CliConfig,
	configCommonSchema,
	configMigrations,
	Driver,
	Prefix
} from '../validations/common';

// NextJs default config is target: es5, which esbuild-register can't consume
const assertES5 = async (unregister: () => void) => {
	try {
		require('./_es5.ts');
	} catch (e: any) {
		if ('errors' in e && Array.isArray(e.errors) && e.errors.length > 0) {
			const es5Error = (e.errors as any[]).filter((it) => it.text?.includes(`("es5") is not supported yet`)).length > 0;
			if (es5Error) {
				console.log(
					console.error(
						`Please change compilerOptions.target from 'es5' to 'es6' or above in your tsconfig.json`,
					),
				);
				process.exit(1);
			}
		}
		console.error(e);
		process.exit(1);
	}
};

export const safeRegister = async () => {
	const pkg = 'esbuild-register/dist/node';
	const { register } = await import(pkg);
	let res: { unregister: () => void };
	try {
		res = register({
			format: 'cjs',
			loader: 'ts',
		});
	} catch {
		// tsx fallback
		res = {
			unregister: () => {},
		};
	}

	// has to be outside try catch to be able to run with tsx
	await assertES5(res.unregister);
	return res;
};

export type GenerateConfig = {
	dialect: Dialect;
	schema: string | string[];
	out: string;
	breakpoints: boolean;
	name?: string;
	prefix: Prefix;
	custom: boolean;
	bundle: boolean;
	casing?: CasingType;
	driver?: Driver;
};

export type ExportConfig = {
	dialect: Dialect;
	schema: string | string[];
	sql: boolean;
};

export const flattenDatabaseCredentials = (config: any) => {
	if ('dbCredentials' in config) {
		const { dbCredentials, ...rest } = config;
		return {
			...rest,
			...dbCredentials,
		};
	}
	return config;
};

export const migrateConfig = object({
	dialect,
	out: string().optional().default('drizzle'),
	migrations: configMigrations,
});

export const drizzleConfigFromFile = async (
	configPath?: string,
	isExport?: boolean,
): Promise<CliConfig> => {
	const prefix = process.env.TEST_CONFIG_PATH_PREFIX || '';

	const defaultTsConfigExists = existsSync(resolve(join(prefix, 'drizzle.config.ts')));
	const defaultJsConfigExists = existsSync(resolve(join(prefix, 'drizzle.config.js')));
	const defaultJsonConfigExists = existsSync(
		join(resolve('drizzle.config.json')),
	);

	const defaultConfigPath = defaultTsConfigExists
		? 'drizzle.config.ts'
		: defaultJsConfigExists
		? 'drizzle.config.js'
		: 'drizzle.config.json';

	if (!configPath && !isExport) {
		console.log(
			chalk.gray(
				`No config path provided, using default '${defaultConfigPath}'`,
			),
		);
	}

	const path: string = resolve(join(prefix, configPath ?? defaultConfigPath));

	if (!existsSync(path)) {
		console.log(`${path} file does not exist`);
		process.exit(1);
	}

	if (!isExport) console.log(chalk.grey(`Reading config file '${path}'`));

	const { unregister } = await safeRegister();
	const required = require(`${path}`);
	const content = required.default ?? required;
	unregister();

	// --- get response and then check by each dialect independently
	const res = configCommonSchema.safeParse(content);
	if (!res.success) {
		console.log(res.error);
		if (!('dialect' in content)) {
			console.log(console.error("Please specify 'dialect' param in config file"));
		}
		process.exit(1);
	}

	return res.data;
};
