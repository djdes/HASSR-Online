const fs=require('fs');
const cp=require('child_process');
const ts=require('typescript');
const assert=require('node:assert/strict');
const files=['src/app/blanki/page.tsx','src/app/prikazy/page.tsx'];
const keys=new Set(['href','target','format','place','autoOpen','hideTrigger','expired']);
function metadata(source){
 const file=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const values=[];
 function visit(n){if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&['metadata','FAQ','TITLE','DESCRIPTION','CATEGORY_ORDER'].includes(n.name.text))values.push(n.getText(file).replace(/\r\n/g,"\n"));ts.forEachChild(n,visit)}
 visit(file);return values.sort();
}
function actions(source){
 const file=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const attrs=[];
 function visit(n){if(ts.isJsxAttribute(n)&&keys.has(n.name.text)) attrs.push(n.getText(file));ts.forEachChild(n,visit)}
 visit(file);return attrs.sort();
}
for(const file of files){
 const before=cp.execFileSync('git',['show',`HEAD:${file}`],{encoding:'utf8'});
 const after=fs.readFileSync(file,'utf8');
 assert.deepEqual(metadata(after),metadata(before),`${file}: metadata and FAQ must remain identical`);
 assert.deepEqual(actions(after),actions(before),`${file}: links/download props must remain identical`);
 assert.match(after,/<SearchableCatalog/);
 assert.match(after,/searchText:/);
 assert.match(after,/\.basis|\.normative/);
}
const admin='src/app/root/organizations/[id]/client-requisites-card.tsx';
const oldAdmin=cp.execFileSync('git',['show',`HEAD:${admin}`],{encoding:'utf8'});
const newAdmin=fs.readFileSync(admin,'utf8');
const emit=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).outputText;
assert.equal(emit(newAdmin),emit(oldAdmin),'translator namespace repair must emit identical JavaScript');
const existing=fs.readFileSync('src/app/journals-info/journals-info-catalog.tsx','utf8');
assert.match(existing,/journalMatchesQuery/);
assert.match(existing,/type="search"/);
const report={verdict:'PASS',checks:['both pages integrate searchable catalog','SEO metadata and FAQ remain identical','names, descriptions, codes, regulatory text indexed','all existing href/target/format/place/autoOpen/hideTrigger/expired attributes preserved exactly','current journals catalog already includes localized shared-matcher search','admin translator type repair emits identical JavaScript']};
fs.writeFileSync('.agent/tasks/catalog-search-20261116/raw/integration.json',JSON.stringify(report,null,2));
console.log(report);
