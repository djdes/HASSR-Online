import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { serializeWebhook } from "./serialize";

const require = createRequire(import.meta.url);
type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
const context = { params: Promise.resolve({ id: "original-id" }) };
const request = (body: unknown = {}) => new Request("http://fixture/settings", {method:"POST",body:JSON.stringify(body)});
function fixture(item: boolean, options: { allowed?: boolean; found?: boolean; count?: number } = {}) {
  const calls: { name: string; input: unknown }[] = [];
  const webhook = {id:"original-id",organizationId:"active-org",url:"https://original.example/hook",secret:"original-secret",events:["journal.entry"],enabled:true,lastSuccessAt:null,lastError:null,createdAt:new Date("2026-10-15T12:00:00Z")};
  const record = (name: string, result: unknown) => async (input: unknown) => { calls.push({name,input});return result; };
  const fixtureModule = {exports:{} as Record<string,Handler>};
  const source=ts.transpileModule(readFileSync(`src/app/api/settings/webhooks/subscriptions/${item?"[id]/":""}route.ts`,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(source,{module:fixtureModule,exports:fixtureModule.exports,Date,Request,Response,
    require:(id:string)=>{
      if(id==="@/lib/auth-helpers")return {requireAuth:async()=>({user:{id:"employee",organizationId:"home-org"}}),getActiveOrgId:()=>"active-org"};
      if(id==="@/lib/role-access")return {hasFullWorkspaceAccess:()=>options.allowed!==false};
      if(id==="@/lib/audit-log")return {recordAuditLog:record("audit",{})};
      if(id==="@/lib/db")return {db:{webhook:{findMany:record("findMany",[webhook]),findFirst:record("findFirst",options.found===false?null:webhook),count:record("count",options.count??0),create:record("create",webhook),update:record("update",webhook),delete:record("delete",{})},webhookDelivery:{findMany:record("deliveries",[]),create:record("delivery",{id:"delivery"})}}};
      if(id==="@/lib/webhooks/sign")return {...require(id),generateWebhookSecret:()=>"new-fixture-secret"};
      if(id==="@/lib/webhooks/dispatch")return {deliverOne:record("send",{ok:true,status:200,error:null})};
      return require(id);
    },
  });
  return {handlers:fixtureModule.exports,calls,webhook};
}

test("webhook APIs keep role/tenant isolation and add compatible validation codes",async()=>{
  for(const item of [false,true])for(const method of item?["PATCH","DELETE","POST"]:["GET","POST"]){
    const view=fixture(item,{allowed:false});const response=await view.handlers[method](request(),context);
    assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:"Доступно руководителям",errorCode:"WEBHOOK_FORBIDDEN"});assert.deepEqual(view.calls,[]);
  }
  for(const method of ["PATCH","DELETE","POST"]){
    const view=fixture(true,{found:false});const response=await view.handlers[method](request(),context);
    assert.equal(response.status,404);assert.deepEqual(await response.json(),{error:"Подписка не найдена",errorCode:"WEBHOOK_NOT_FOUND"});
    assert.deepEqual(JSON.parse(JSON.stringify(view.calls)),[{name:"findFirst",input:{where:{id:"original-id",organizationId:"active-org"}}}]);
  }
  for(const item of [false,true])for(const kind of ["url","events"]){
    const view=fixture(item);const response=await view.handlers[item?"PATCH":"POST"](request(kind==="url"?{url:"http://localhost/hook",events:["journal.entry"]}:{url:"https://original.example/hook",events:[]}),context);
    assert.equal(response.status,400);assert.equal((await response.json()).errorCode,kind==="url"?"WEBHOOK_INVALID_URL":"WEBHOOK_MISSING_EVENTS");
    assert.ok(!view.calls.some(call=>["create","update","audit"].includes(call.name)));
  }
  const limited=fixture(false,{count:10});const response=await limited.handlers.POST(request({url:"https://original.example/hook",events:["journal.entry"]}),context);
  assert.equal(response.status,429);assert.deepEqual(await response.json(),{error:"Не больше 10 подписок",errorCode:"WEBHOOK_LIMIT",errorParams:{limit:10}});
  assert.ok(!limited.calls.some(call=>call.name==="create"));
});

test("webhook GET/create/update/delete/test keep canonical values and delivery payloads",async()=>{
  const list=fixture(false);const response=await list.handlers.GET(request(),context);
  assert.deepEqual(await response.json(),{webhooks:[serializeWebhook(list.webhook)],deliveries:[]});
  assert.equal((list.calls[0].input as {where:{organizationId:string}}).where.organizationId,"active-org");
  assert.equal((list.calls[1].input as {where:{webhook:{organizationId:string}}}).where.webhook.organizationId,"active-org");
  const create=fixture(false);await create.handlers.POST(request({url:" https://customer.example/original ",events:["journal.entry","payment.paid","unknown"]}),context);
  const created=JSON.parse(JSON.stringify(create.calls.find(call=>call.name==="create")!.input));
  assert.deepEqual(created.data,{organizationId:"active-org",url:"https://customer.example/original",secret:"new-fixture-secret",events:["journal.entry","payment.paid"],enabled:true,createdById:"employee"});
  const patch=fixture(true);await patch.handlers.PATCH(request({enabled:false,rotateSecret:true,events:["idea.status"]}),context);
  assert.deepEqual(JSON.parse(JSON.stringify(patch.calls.find(call=>call.name==="update")!.input)),{where:{id:"original-id"},data:{events:["idea.status"],enabled:false,secret:"new-fixture-secret"}});
  const audit=patch.calls.find(call=>call.name==="audit")!.input as {organizationId:string;details:{secret:string}};
  assert.equal(audit.organizationId,"active-org");assert.equal(audit.details.secret,"rotated");
  const remove=fixture(true);await remove.handlers.DELETE(request(),context);assert.equal(remove.calls.filter(call=>call.name==="delete").length,1);
  const send=fixture(true);await send.handlers.POST(request(),context);
  const delivery=JSON.parse(JSON.stringify(send.calls.find(call=>call.name==="delivery")!.input)).data;
  assert.equal(delivery.webhookId,"original-id");assert.equal(delivery.event,"ping");assert.equal(delivery.payload.organizationId,"active-org");
  assert.deepEqual(delivery.payload.data,{message:"Тестовое событие из WeSetup"});
  assert.equal(send.calls.find(call=>call.name==="send")!.input,"delivery");
});
