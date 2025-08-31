import { enum as enumType, TypeOf, union } from 'zod';
import { sqliteSchema, SQLiteSchemaSquashed } from './serializer/sqliteSchema';

export const dialects = ['sqlite'] as const;
export const dialect = enumType(dialects);

export type Dialect = (typeof dialects)[number];
const _: Dialect = '' as TypeOf<typeof dialect>;

const commonSquashedSchema = union([
	SQLiteSchemaSquashed,
]);

const commonSchema = union([sqliteSchema]);

export type CommonSquashedSchema = TypeOf<typeof commonSquashedSchema>;
export type CommonSchema = TypeOf<typeof commonSchema>;
