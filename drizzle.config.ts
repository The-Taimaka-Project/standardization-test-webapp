import 'dotenv/config';
import type { Config } from 'drizzle-kit';

const schema = process.env.DATABASE_SCHEMA ?? 'standardization';

export default {
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  schemaFilter: [schema],
  verbose: true,
  strict: true,
} satisfies Config;
