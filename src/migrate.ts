import 'dotenv/config';
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
if (!process.env.APP_DATABASE_URL) throw new Error('APP_DATABASE_URL is required');
if (process.env.APP_DATABASE_URL === process.env.PRICE_DATABASE_URL) throw new Error('Use a separate application database');
const p = new pg.Pool({connectionString:process.env.APP_DATABASE_URL});
const client=await p.connect();
try { await client.query('SELECT pg_advisory_lock(428108)');await client.query('BEGIN');for(const file of (await readdir(new URL('../sql/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await client.query(await readFile(new URL('../sql/'+file,import.meta.url),'utf8'));await client.query('COMMIT');console.log('FutBot application schema ready'); }
catch(error){await client.query('ROLLBACK');throw error;}
finally {await client.query('SELECT pg_advisory_unlock(428108)').catch(()=>{});client.release();await p.end();}
