import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@libsql/client/web';
import { openStore } from '../server/store.mjs';
import { buildUploadPlan, uploadTables } from './upload-plan.mjs';

// Optional one-time transfer. Never modifies the original SQLite database.
const filename=resolve(process.env.SMART_MONITOR_DB||'data/monitor.sqlite');
if(!existsSync(filename))throw new Error('Local database not found. Set SMART_MONITOR_DB to the existing SQLite file.');
if(!process.env.TURSO_DATABASE_URL||!process.env.TURSO_AUTH_TOKEN)throw new Error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in your private .env first.');
mkdirSync('backups',{recursive:true});
const copy=resolve('backups',`upload-${Date.now()}.sqlite`);
const original=new DatabaseSync(filename,{readOnly:true});
try{await backup(original,copy);}finally{original.close();}
const local=await openStore(copy);
const tables=uploadTables;
const rows=Object.fromEntries(tables.map(table=>[table,local.db.prepare(`SELECT * FROM ${table}`).all()]));
local.close();
const remoteOptions={url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN};
const remote=await openStore(':memory:',remoteOptions);remote.close();
const statements=buildUploadPlan(rows);
const client=createClient(remoteOptions);
try{
  // One atomic batch; guard refuses to overwrite an already-used remote database.
  await client.batch(statements,'write');
  console.log(`Uploaded ${tables.map(t=>`${rows[t].length} ${t}`).join(', ')}. Local backup: ${copy}`);
}catch(error){console.error('Upload failed or target already contains data. No partial upload committed. Original local file is unchanged.');process.exitCode=1;}
finally{client.close();}
