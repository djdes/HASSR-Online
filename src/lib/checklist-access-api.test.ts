import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { JOURNAL_ACCESS_CATALOG } from "./journal-access-catalog";
import { ACTIVE_JOURNAL_CATALOG } from "./journal-catalog";

function accessHandler(role = "owner") {
  const writes: {templateCode:string;canFinalize:boolean}[]=[];
  const session={user:{id:"owner",role,isRoot:false}};
  const users={worker:{id:"worker",organizationId:"qa-org",name:"QA worker",role:"cook",jobPositionId:null,journalAccessMigrated:true,notificationPrefs:{assignments:false}},foreign:{id:"foreign",organizationId:"other",role:"cook"}};
  const db={user:{findUnique:async({where}:{where:{id:keyof typeof users}})=>users[where.id],update:async()=>({})},organization:{findUnique:async()=>({disabledJournalCodes:[],orgNo:1})},userJournalAccess:{findMany:async()=>[],deleteMany:async()=>({count:0}),create:async({data}:{data:{templateCode:string;canFinalize:boolean}})=>{writes.push(data);return data;}},$transaction:async(operations:Promise<unknown>[])=>Promise.all(operations)};
  const fakeModule={exports:{}};
  const source=ts.transpileModule(readFileSync(path.join(process.cwd(),"src/app/api/users/[id]/access/route.ts"),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{module:fakeModule,exports:fakeModule.exports,console,Response,Request,require:(name:string)=>{
    if(name==="next/server")return {NextResponse:Response};
    if(name==="@/lib/server-session")return {getServerSession:async()=>session};
    if(name==="@/lib/auth")return {authOptions:{}};
    if(name==="@/lib/db")return {db};
    if(name==="@/lib/auth-helpers")return {getActiveOrgId:()=>"qa-org"};
    if(name==="@/lib/journal-acl")return {invalidateJournalAcl:()=>{}};
    if(name==="@/lib/user-roles")return {isManagementRole:(value:string)=>["owner","manager"].includes(value)};
    if(name==="@/lib/journal-access-catalog")return {JOURNAL_ACCESS_CATALOG};
    if(name==="@/lib/telegram")return {escapeTelegramHtml:(value:string)=>value,notifyEmployee:()=>{throw Error("Notifications must be disabled for this fixture");}};
    if(name==="@/lib/login-prefix")return {orgLoginPrefix:()=>"qa"};
    throw Error(`Unexpected access API dependency: ${name}`);
  }});
  return {...fakeModule.exports as {GET:(request:Request,ctx:{params:Promise<{id:string}>})=>Promise<Response>;PUT:(request:Request,ctx:{params:Promise<{id:string}>})=>Promise<Response>},writes};
}
test("constructor is visible and persistable in real employee-access handlers without becoming a regulatory grid",async()=>{
  const handler=accessHandler();const context={params:Promise.resolve({id:"worker"})};
  const response=await handler.GET(new Request("http://local/api/users/worker/access"),context);assert.equal(response.status,200);
  const body=await response.json();assert.ok(body.catalog.some((item:{code:string})=>item.code==="custom_checklists"));
  const saved=await handler.PUT(new Request("http://local/api/users/worker/access",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({access:[{templateCode:"custom_checklists",canRead:true,canWrite:true,canFinalize:true}]})}),context);
  assert.equal(saved.status,200);assert.equal(handler.writes.length,1);assert.equal(handler.writes[0].templateCode,"custom_checklists");assert.equal(handler.writes[0].canFinalize,true);
  assert.ok(!new Set<string>(ACTIVE_JOURNAL_CATALOG.map(item=>item.code)).has("custom_checklists"));
});
test("constructor grants retain employee-role and tenant boundaries",async()=>{
  for(const [role,id,expected] of [["cook","worker",403],["owner","foreign",403]] as const){const handler=accessHandler(role);const response=await handler.PUT(new Request("http://local/api/users/worker/access",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({access:[{templateCode:"custom_checklists",canRead:true,canWrite:true,canFinalize:true}]})}),{params:Promise.resolve({id})});assert.equal(response.status,expected);assert.equal(handler.writes.length,0);}
});
