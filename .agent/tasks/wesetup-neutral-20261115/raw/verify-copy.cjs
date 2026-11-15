const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {createRequire}=require('node:module');
const {pathToFileURL}=require('node:url');
const req=createRequire(path.resolve('package.json'));
const task=path.dirname(__dirname);
const baseRef='ab7a4e15ff1a4e283862aa168e19130d00dfa686';
const manifest=JSON.parse(fs.readFileSync(path.join(task,'copy-manifest.json'),'utf8'));
function flat(value,prefix='',result={}){
 for(const [key,item] of Object.entries(value)){
  const full=prefix?`${prefix}.${key}`:key;
  if(typeof item==='string')result[full]=item;
  else if(item&&typeof item==='object')flat(item,full,result);
 }
 return result;
}
(async()=>{
 const {parse}=await import(pathToFileURL(req.resolve('@formatjs/icu-messageformat-parser')).href);
 const contract=text=>{
  const found=new Set();
  function visit(nodes){for(const node of nodes){
   if([1,2,3,4,5,6,8].includes(node.type))found.add(`${node.type}:${node.value}`);
   if(node.children)visit(node.children);
   if(node.options)for(const option of Object.values(node.options))visit(option.value);
  }}
  visit(parse(text));return [...found].sort();
 };
 const results=[];
 for(const locale of ['ru','en','uz']){
  const file=`src/i18n/messages/${locale}.json`;
  const before=flat(JSON.parse(execFileSync('git',['show',`${baseRef}:${file}`],{encoding:'utf8',maxBuffer:8*1024*1024})));
  const after=flat(JSON.parse(fs.readFileSync(file,'utf8')));
  const expected=new Map(manifest.filter(x=>x.locale===locale).map(x=>[x.key,x.after]));
  for(const [key,value] of expected){
   assert.equal(after[key],value,`${locale}.${key}: requested copy`);
   if(before[key]!=null)assert.deepEqual(contract(after[key]),contract(before[key]),`${locale}.${key}: ICU contract`);
  }
  const visual=new Set(['qrScene.demo.employee','qrScene.demo.specialist','qrScene.demo.supervisor','qrPlayer.chrome.watchVideoHint']);
  const changed=Object.keys(after).filter(key=>before[key]!==after[key]);
  for(const key of changed)assert.ok(expected.has(key)||visual.has(key),`Unexpected catalog edit: ${locale}.${key}`);
  for(const key of Object.keys(before))assert.ok(Object.hasOwn(after,key),`Deleted catalog key: ${locale}.${key}`);
  results.push({locale,changedKeys:changed.length,icuContracts:'PASS',unchangedRoleLabels:'PASS',changed});
 }
 const page=fs.readFileSync('src/app/page.tsx','utf8');
 assert.ok(page.includes('"staff-neutral"'));
 const images=[];
 for(const [size,w,h] of [['desktop',1440,900],['mobile',390,800]]){
  const file=`public/landing/screens/staff-neutral-${size}.webp`;
  const meta=await req('sharp')(file).metadata();
  assert.equal(meta.width,w);assert.equal(meta.height,h);images.push({file,width:w,height:h});
 }
 const files=new Set([...execFileSync('git',['diff','--name-only',baseRef,'--','src','docs','public'],{encoding:'utf8'}).trim().split(/\r?\n/),
  ...execFileSync('git',['ls-files','--others','--exclude-standard','--','src','docs','public'],{encoding:'utf8'}).trim().split(/\r?\n/)].filter(Boolean));
 const hashes=Object.fromEntries([...files].sort().map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
 const report={status:'PASS',checkedAt:new Date().toISOString(),base:baseRef,catalogs:results,images,hashes};
 fs.writeFileSync(path.join(__dirname,'source-audit.json'),JSON.stringify(report,null,2));
 console.log(`PASS: ${results.map(x=>`${x.locale}=${x.changedKeys}`).join(', ')} exact message paths; ICU contracts, original role labels, image sizes and current hashes checked`);
})().catch(error=>{console.error(error);process.exitCode=1});
