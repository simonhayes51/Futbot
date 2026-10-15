import 'dotenv/config';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
if (!process.env.APP_DATABASE_URL) throw new Error('APP_DATABASE_URL is required');
if (process.env.APP_DATABASE_URL === process.env.PRICE_DATABASE_URL) throw new Error('Use a separate application database');
const p = new pg.Pool({connectionString:process.env.APP_DATABASE_URL});
try { await p.query(await readFile(new URL('../sql/001-app.sql',import.meta.url),'utf8')); console.log('FutBot application schema ready'); }
finally { await p.end(); }
