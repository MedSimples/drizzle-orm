/// <reference types="bun-types" />
import * as tsup from 'tsup';

const main = async () => {
	await tsup.build({
		entryPoints: ['./src/api.ts'],
		outDir: './dist',
		external: ['bun:sqlite', 'json-diff'],
		noExternal: ['(.*)'],
		splitting: false,
		dts: true,
		format: ['esm'],
		outExtension: (ctx) => {
			return {
				dts: '.d.ts',
				js: '.js',
			};
		},
	});
};

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
