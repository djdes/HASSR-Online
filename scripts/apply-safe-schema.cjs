const {spawnSync}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {additiveSchemaSql}=require('./lib/schema-safety.cjs');
require('dotenv').config({quiet:true});
async function main(){
  const prisma=path.join(process.cwd(),'node_modules/prisma/build/index.js');
  const result=spawnSync(process.execPath,[prisma,'migrate','diff','--from-config-datasource','--to-schema','prisma/schema.prisma','--script'],{encoding:'utf8',maxBuffer:16*1024*1024});
  if(result.status!==0)throw new Error('Could not inspect current database schema; no changes applied');
  const reviewed=additiveSchemaSql(result.stdout);
  const hash=crypto.createHash('sha256').update(reviewed.sql).digest('hex');
  if(process.env.SCHEMA_REVIEW_OUTPUT)fs.writeFileSync(process.env.SCHEMA_REVIEW_OUTPUT,reviewed.sql,{mode:0o600});
  console.log(JSON.stringify({schemaStatements:reviewed.statementCount,preservedIndexes:reviewed.preserved,sha256:hash,dryRun:process.argv.includes('--dry-run')}));
  if(!reviewed.sql || process.argv.includes('--dry-run'))return;
  const pg=require('pg');const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
  try{await client.query('BEGIN');await client.query("SET LOCAL lock_timeout = '15s'");await client.query("SELECT pg_advisory_xact_lock(hashtext('wesetup-safe-schema-deploy'))");await client.query(reviewed.sql);await client.query('COMMIT');console.log('Additive schema changes committed');}
  catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
}
main().catch(error=>{console.error(error.message?.replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[database URL redacted]')||'Schema update failed');process.exitCode=1});
