/// <reference types="bun-types" />
import { readFileSync, writeFileSync } from 'fs';
import * as tsup from 'tsup';

const driversPackages = [
	// postgres drivers
	'pg',
	'postgres',
	'@vercel/postgres',
	'@neondatabase/serverless',
	'@electric-sql/pglite',
	//  mysql drivers
	'mysql2',
	'@planetscale/database',
	// sqlite drivers
	'@libsql/client',
	'better-sqlite3',
	'bun:sqlite',
];

// esbuild.buildSync({
// 	entryPoints: ['./src/utils.ts'],
// 	bundle: true,
// 	outfile: 'dist/utils.js',
// 	format: 'cjs',
// 	target: 'node16',
// 	platform: 'node',
// 	external: [
// 		'commander',
// 		'json-diff',
// 		'glob',
// 		'esbuild',
// 		'drizzle-orm',
// 		...driversPackages,
// 	],
// 	banner: {
// 		js: `#!/usr/bin/env node`,
// 	},
// });

// esbuild.buildSync({
// 	entryPoints: ['./src/utils.ts'],
// 	bundle: true,
// 	outfile: 'dist/utils.mjs',
// 	format: 'esm',
// 	target: 'node16',
// 	platform: 'node',
// 	external: [
// 		'commander',
// 		'json-diff',
// 		'glob',
// 		'esbuild',
// 		'drizzle-orm',
// 		...driversPackages,
// 	],
// 	banner: {
// 		js: `#!/usr/bin/env node`,
// 	},
// });

// esbuild.buildSync({
// 	entryPoints: ['./src/cli/index.ts'],
// 	bundle: true,
// 	outfile: 'dist/bin.cjs',
// 	format: 'cjs',
// 	target: 'node16',
// 	platform: 'node',
// 	define: {
// 		'process.env.DRIZZLE_KIT_VERSION': `"${pkg.version}"`,
// 	},
// 	external: [
// 		'esbuild',
// 		'drizzle-orm',
// 		...driversPackages,
// 	],
// 	banner: {
// 		js: `#!/usr/bin/env node`,
// 	},
// });

const main = async () => {
	await tsup.build({
		entryPoints: ['./src/api.ts'],
		outDir: './dist',
		external: ['bun:sqlite', 'json-diff'],
		noExternal: ['(.*)'],
		splitting: true,
		dts: true,
		format: ['cjs'],
		outExtension: (ctx) => {
			return {
				dts: '.d.cts',
				js: '.cjs',
			};
		},
	});

	const apiCjs = readFileSync('./dist/api.cjs', 'utf8').replace(/await import\(/g, 'require(');
	writeFileSync('./dist/api.cjs', apiCjs);
};

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
