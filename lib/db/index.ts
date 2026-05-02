import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');

declare global {
  var __pgPool: Pool | undefined;
}

const pool =
  global.__pgPool ??
  new Pool({
    connectionString: url,
    max: 5,
    ssl: { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== 'production') global.__pgPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
