import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
export async function testDatabase(){const db=new PGlite();for(const file of (await readdir(new URL('../sql/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL('../sql/'+file,import.meta.url),'utf8'));
 const query=async(sql:string,values?:any[])=>{const r:any=await db.query(sql,values);return {...r,rowCount:r.affectedRows||r.rows.length};};const pool:any={query,connect:async()=>({query,release(){}})};return {db,pool};}
