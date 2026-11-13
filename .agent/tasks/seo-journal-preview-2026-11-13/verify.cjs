const fs=require('node:fs');
const path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const phase=process.argv[2]||'builder';
const root=process.cwd();
const out=path.join(__dirname,'raw',phase);
fs.mkdirSync(out,{recursive:true});
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const head=()=>execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const files=['src/components/landing/seo-journal-landing.tsx','src/components/public/journal-screenshot.tsx','package-lock.json'];
const specSha=sha(path.join(__dirname,'spec.md'));
assert.equal(specSha,fs.readFileSync(path.join(__dirname,'raw/spec-frozen.sha256'),'utf8').trim());
const report={phase,node:process.version,startedAt:new Date().toISOString(),head:head(),specSha256:specSha,
  hashes:Object.fromEntries(files.map(file=>[file,sha(file)])),commands:[]};
const env={...process.env,PATH:`${path.dirname(process.execPath)};C:/Program Files/Git/bin;C:/Program Files/Git/usr/bin;${process.env.PATH}`,
  DATABASE_URL:'postgresql://fixture:fixture@127.0.0.1:1/wesetup_test',NEXT_TELEMETRY_DISABLED:'1'};
const npm='C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js';
async function command(name,args){
  const log=path.join(out,`${name}.log`),stream=fs.createWriteStream(log);
  console.log(`START ${name}`);
  const startedAt=new Date().toISOString();
  const child=spawn(process.execPath,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false});
  const exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  await new Promise(resolve=>stream.end(resolve));
  report.commands.push({name,args,startedAt,endedAt:new Date().toISOString(),exitCode,log:path.relative(__dirname,log)});
  fs.writeFileSync(path.join(out,'commands.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`END ${name}: ${exitCode}`);
  assert.equal(exitCode,0,`${name} failed; see ${log}`);
}
(async()=>{
  await command('browser',[path.join(__dirname,'browser-check.cjs'),phase]);
  await command('lint',['node_modules/eslint/bin/eslint.js',...files.filter(file=>file.endsWith('.tsx'))]);
  await command('typecheck',[npm,'run','typecheck']);
  await command('test-gate',[npm,'run','test:gate']);
  report.headAfter=head();
  assert.equal(report.headAfter,report.head,'Repository HEAD changed during verification');
  assert.equal(sha(path.join(__dirname,'spec.md')),specSha,'Frozen specification changed');
  for(const file of files)assert.equal(sha(file),report.hashes[file],`Verification input changed: ${file}`);
  report.inputsStable=true;report.endedAt=new Date().toISOString();report.verdict='PASS';
  fs.writeFileSync(path.join(out,'commands.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`PASS ${phase}: ${report.head}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
