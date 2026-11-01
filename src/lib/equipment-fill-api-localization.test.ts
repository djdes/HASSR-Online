import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { qrResponseFeedback } from "@/components/qr-fill/qr-fill-presentation";
import { loadMessages } from "@/i18n/messages";
import { createTranslator } from "use-intl/core";
import { equipmentFillRu } from "@/i18n/equipment-fill-ru.generated";

type Handler = (request: Request, context?: { params: Promise<{equipmentId:string}> }) => Promise<Response>;
function route(file:string,mocks:Record<string,unknown>) {
  const require=createRequire(import.meta.url),mod={exports:{}};
  const source=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(source,{module:mod,exports:mod.exports,console,Date,URL,Request,Response,Uint8Array,require:(id:string)=>{
    if(Object.hasOwn(mocks,id))return mocks[id];
    if(id==="@/lib/db"||id==="@/lib/ai-vision/reading"||id==="@/lib/reading-photo-store")throw Error(`Unmocked side effect: ${id}`);
    return require(id);
  }});return mod.exports as {POST:Handler;GET:Handler};
}
const request=(body:unknown)=>new Request("https://fixture.invalid/api",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
const base={token:"fixture-token",employeeId:"person"};
const target={kind:"equipment",objectId:"equipment",...base};
const context={params:Promise.resolve({equipmentId:"equipment"})};
test("shared QR Russian compatibility catalog is identical to canonical RU", async()=>{
  assert.deepEqual(equipmentFillRu,(await loadMessages("ru")).equipmentFill,"Run node scripts/generate-qr-fill-fallback.cjs after equipmentFill catalog changes");
});
const photo="/uploads/readings/0123456789abcdef0123456789abcdef.jpg";
function fixture(options:{deny?:boolean;invalid?:boolean;limited?:boolean;missing?:boolean;uv?:boolean;required?:boolean;noDocument?:boolean;climate?:boolean;otherPoint?:boolean}={}) {
  const writes:Record<string,unknown>[]=[],audits:Record<string,unknown>[]=[],toggles:Record<string,unknown>[]=[],reads:unknown[]=[];
  const person={id:"person",name:"Customer O‘tkir",role:"cook",canManageSettings:false,qrPinHash:"hash",buildingIds:options.otherPoint?["pb"]:[]};
  const actor=options.deny?{ok:false,status:403,error:"legacy wrong PIN",errorCode:"equipmentFill.errors.pinWrong",errorParams:{attempts:3}}:{ok:true,employee:person};
  const equipment={id:"equipment",name:"Customer freezer",type:options.uv?"uv_lamp":"freezer",tempMin:0,tempMax:8,lampLifetimeHours:100,fillerUserIds:[],area:{id:"area",name:"Customer area",organizationId:"verified-org",organization:{timezone:"Asia/Tashkent",qrFillMode:"public"}}};
  const mocks:Record<string,unknown>={
    "@/lib/db":{db:{equipment:{findUnique:async()=>{reads.push("equipment");return equipment;}},user:{findFirst:async(q:{where:{organizationId:string}})=>{assert.equal(q.where.organizationId,"verified-org");return options.missing?null:person;},findUnique:async()=>person},journalDocumentEntry:{findUnique:async()=>({data:{responsibleTitle:"Customer title",temperatures:{other:2}}}),findMany:async()=>[],upsert:async(q:Record<string,unknown>)=>{writes.push(q);}}}},
    "@/lib/qr-point-roster":{QR_POINT_DENIED:"legacy other point",QR_POINT_DENIED_CODE:"equipmentFill.errors.otherPoint",loadQrPointScope:async(org:string)=>{assert.equal(org,"verified-org");return options.otherPoint?{buildingId:"pa",buildingName:"Point A",orgBuildingIds:["pa","pb"]}:null;},worksAtQrPoint:(scope:{buildingId:string}|null,ids:string[]|undefined)=>!scope||(ids??[]).length===0||(ids??[]).includes(scope.buildingId),employeeWorksAtQrPoint:async(scope:{buildingId:string}|null)=>!scope},
    "@/lib/equipment-qr-token":{verifyEquipmentQrToken:()=>options.invalid?{ok:false}:{ok:true,equipmentId:"equipment"}},
    "@/lib/client-ip":{clientIp:()=>"fixture-ip"},
    "@/lib/qr-fill-actor":{normalizeQrFillMode:(v:string)=>v,resolveQrFillActor:async()=>actor},
    "@/lib/qr-object-pass":{resolveObjectActor:async(q:{organizationId:string})=>{assert.equal(q.organizationId,"verified-org");return actor;},readObjectPassCookie:async()=>null,resolveQrObject:async()=>options.invalid?null:{organizationId:"verified-org",mode:"public"}},
    "@/lib/rate-limit":{qrFillRateLimiter:{consume:()=>!options.limited},readingPhotoRateLimiter:{consume:()=>true,refund:()=>{}}},
    "@/lib/qr-fill-audit":{QR_FILL_RATE_LIMIT_ERROR:"legacy rate limit",qrFillRateKey:()=>"fixture",recordQrFillAudit:async(q:Record<string,unknown>)=>{audits.push(q);}},
    "@/lib/reading-photo-fixation.server":{getReadingPhotoSettings:async()=>({enabled:true,required:options.required??false})},
    "@/lib/reading-photo-store":{readingPhotoExists:async()=>true,readReadingPhoto:async()=>new Uint8Array([1,2]),saveReadingPhoto:async()=>({url:photo}),READING_PHOTO_MAX_BYTES:6*1024*1024},
    "@/lib/equipment-fill-targets":{EQUIPMENT_FILL_NO_DOCUMENT_ERROR:"legacy no document",resolveEquipmentFillTargets:async()=>({hasActiveDocument:!options.noDocument,coldDocuments:[{id:"doc",items:[{id:"slot",name:"Customer freezer",sourceEquipmentId:"equipment",min:0,max:8}]}],climate:options.climate?{documentId:"climate-doc",config:{controlTimes:["10:00"]},row:{id:"room-area-area",humidity:{enabled:true,min:20,max:80}}}:null})},
    "@/lib/temperature-deviations":{subjectKeyForEquipment:(id:string)=>id,processTemperatureReading:async()=>{}},
    "@/lib/uv-lamp-runs":{ensureUvDocumentForLamp:async()=>({id:"doc",responsibleUserId:null}),listLampOperators:async()=>[person],lampState:async()=>({running:null,lifetimeHours:100,usedHours:2,remainingHours:98}),toggleLamp:async(q:Record<string,unknown>)=>{toggles.push(q);return {ok:true,action:q.action,hours:1.5,durationLabel:"1 ч 30 мин"};}},
    "@/lib/qr-reading-photo":{authorizeQrReadingPhoto:async()=>options.deny?actor:{ok:true,actor:{organizationId:"verified-org",employee:person,photo:{enabled:true,required:false},autofill:true,tariffsHref:null}}},
    "@/lib/qr-pin-pass":{qrPinFingerprint:()=>"fp",mintQrPass:()=>"signed-pass",qrPassSetCookie:()=>"pass=signed-pass",qrPassClearCookie:()=>"pass=; Max-Age=0"},
    "@/lib/qr-remember":{rememberSetCookie:()=>"remember=person",rememberClearCookie:()=>"remember=; Max-Age=0"},
    "@/lib/qr-pin-requests":{latestQrPinRequestFor:async()=>({kind:"new",status:"rejected",decisionNote:"Customer note <&>",decidedAt:new Date()}),createQrPinRequest:async(q:Record<string,unknown>)=>{writes.push(q);return {ok:true};}},
    "@/lib/ai-vision/reading":{READING_PAID_ONLY_CODE:"paid_only",recognizeReading:async()=>({ok:false,status:503,error:"raw dispatcher error"})},
  };
  return {mocks,writes,audits,toggles,reads};
}
test("actual equipment handler adds codes before writes, preserves canonical measurements, correction and audit values",async()=>{
  for(const [options,body,status,key] of [
    [{invalid:true},{...base,temperature:4},401,"errors.invalidSticker"],
    [{limited:true},{...base,temperature:4},429,"errors.rateLimit"],
    [{deny:true},{...base,temperature:4},403,"errors.pinWrong"],
    [{missing:true},{...base,temperature:4},404,"errors.employeeNotFound"],
    [{otherPoint:true},{...base,temperature:4},403,"errors.otherPoint"],
    [{required:true},{...base,temperature:4},400,"photo.requiredError"],
    [{noDocument:true},{...base,temperature:4},409,"reading.noDocument"],
    [{},{...base,temperature:12},400,"errors.correctionRequired"],
  ] as const){const f=fixture(options);const response=await route("src/app/api/equipment-fill/[equipmentId]/route.ts",f.mocks).POST(request(body),context);assert.equal(response.status,status);assert.equal((await response.json()).errorCode,`equipmentFill.${key}`);assert.equal(f.writes.length,0);assert.equal(f.audits.length,0);if("invalid" in options)assert.equal(f.reads.length,0);}
  for(const body of [{...base,temperature:4},{...base,temperature:12,correction:"Проверил режим оборудования"},{...base,status:"repair"}]){
    const f=fixture();const response=await route("src/app/api/equipment-fill/[equipmentId]/route.ts",f.mocks).POST(request(body),context);assert.equal(response.status,200);assert.equal(f.writes.length,1);
    const written=JSON.parse(JSON.stringify(f.writes[0])) as {create:{data:{temperatures:Record<string,unknown>;statuses?:Record<string,string>;corrections?:Record<string,string>;responsibleTitle:string};employeeId:string;date:string}};
    assert.equal(written.create.employeeId,"person");assert.equal(written.create.data.responsibleTitle,"Customer title");assert.equal(written.create.data.temperatures.other,2);assert.equal(written.create.data.temperatures.slot,"status" in body?null:body.temperature);
    if("status" in body){assert.equal(written.create.data.statuses?.slot,"repair");assert.deepEqual(JSON.parse(JSON.stringify(f.audits[0].values)),{status:"рем"});}
    if("correction" in body)assert.equal(written.create.data.corrections?.slot,body.correction);
    assert.equal(f.audits[0].objectName,"Customer freezer");assert.equal(f.audits[0].organizationId,"verified-org");assert.equal(written.create.date,`${f.audits[0].dateKey}T00:00:00.000Z`);
  }
});
test("actual UV handler retains on/off action, tenant, timezone, duration and audit payload",async()=>{
  for(const action of ["on","off"]){const f=fixture({uv:true});const response=await route("src/app/api/equipment-fill/[equipmentId]/uv/route.ts",f.mocks).POST(request({...base,action}),context);assert.equal(response.status,200);const result=await response.json();assert.equal(result.durationLabel,"1 ч 30 мин");assert.equal(result.hours,1.5);assert.equal(f.toggles[0].action,action);assert.equal(f.toggles[0].timeZone,"Asia/Tashkent");assert.equal(f.toggles[0].organizationId,"verified-org");assert.deepEqual(JSON.parse(JSON.stringify(f.audits[0].values)),action==="on"?{uvAction:"on"}:{uvAction:"off",hours:1.5});}
  const f=fixture({uv:true,deny:true});assert.equal((await route("src/app/api/equipment-fill/[equipmentId]/uv/route.ts",f.mocks).POST(request({...base,action:"on"}),context)).status,403);assert.equal(f.toggles.length,0);
  const other=fixture({uv:true,otherPoint:true});const denied=await route("src/app/api/equipment-fill/[equipmentId]/uv/route.ts",other.mocks).POST(request({...base,action:"on"}),context);assert.equal(denied.status,403);assert.equal((await denied.json()).errorCode,"equipmentFill.errors.otherPoint");assert.equal(other.toggles.length,0);
});
test("actual climate target keeps numeric humidity, source correction, photo and organization calendar date",async()=>{
 const f=fixture({climate:true});const response=await route("src/app/api/equipment-fill/[equipmentId]/route.ts",f.mocks).POST(request({...base,temperature:4,humidity:95,correction:"Customer custom action",photo}),context);assert.equal(response.status,200);assert.equal(f.writes.length,2);
 const rows=JSON.parse(JSON.stringify(f.writes)) as {create:{documentId:string;date:string;data:{measurements:Record<string,Record<string,unknown>>;corrections:Record<string,string>;readingPhotos:Record<string,string>}}}[];
 assert.deepEqual(rows[1].create.data.measurements["room-area-area"]["10:00"],{temperature:4,humidity:95});assert.equal(rows[1].create.data.corrections["room-area-area:10:00:humidity"],"Customer custom action");assert.equal(rows[0].create.data.readingPhotos.slot,photo);assert.equal(rows[1].create.date,`${f.audits[0].dateKey}T00:00:00.000Z`);assert.equal(f.audits[0].humidity,95);
});
test("actual pass and PIN request handlers retain cookies, custom notes and exact PIN request payload",async()=>{
  const f=fixture();const pass=route("src/app/api/qr-fill/pass/route.ts",f.mocks);const success=await pass.POST(request({...target,pin:"1357",remember:true}));assert.equal((await success.json()).pass,"signed-pass");assert.match(success.headers.get("set-cookie")??"",/remember=person/);assert.match(success.headers.get("set-cookie")??"",/pass=signed-pass/);
  const denied=fixture({deny:true});const rejected=await route("src/app/api/qr-fill/pass/route.ts",denied.mocks).POST(request({...target,pin:"1357"}));assert.equal(rejected.status,403);assert.deepEqual((await rejected.json()).errorParams,{attempts:3});
  const foreign=fixture({otherPoint:true});const otherPoint=await route("src/app/api/qr-fill/pass/route.ts",foreign.mocks).POST(request({...target,pin:"1357"}));assert.equal(otherPoint.status,403);assert.equal((await otherPoint.json()).errorCode,"equipmentFill.errors.otherPoint");
  const pin=route("src/app/api/qr-fill/pin-request/route.ts",f.mocks);const get=await pin.GET(new Request(`https://fixture.invalid/api?${new URLSearchParams(target)}`));const body=await get.json();assert.equal(body.status.messageCode,"equipmentFill.pin.rejected");assert.equal(body.status.messageParams.note,"Customer note <&>");assert.ok(body.status.text.includes("Customer note <&>"));
  const sent=await pin.POST(request({...target,pin:"1357",pin2:"1357",requestKind:"change"}));assert.equal(sent.status,200);assert.equal((await sent.json()).status.messageCode,"equipmentFill.pin.pending");assert.equal(f.writes[0].organizationId,"verified-org");assert.equal(f.writes[0].source,"equipment-fill");assert.equal(f.writes[0].pin,"1357");assert.equal(f.writes[0].kind,"change");
});
test("actual upload and recognition handlers forward stable denial and unknown-service fallback descriptors",async()=>{
  for(const deny of [false,true]){const f=fixture({deny});const upload=route("src/app/api/qr-fill/reading-photo/route.ts",f.mocks);const form=new FormData();for(const [key,value] of Object.entries(target))form.set(key,value);form.set("photo",new Blob(["fixture"],{type:"image/jpeg"}),"fixture.jpg");const result=await upload.POST(new Request("https://fixture.invalid/api",{method:"POST",body:form}));assert.equal(result.status,deny?403:200);assert.equal((await result.json())[deny?"errorCode":"url"],deny?"equipmentFill.errors.pinWrong":photo);}
  const f=fixture();const recognize=route("src/app/api/qr-fill/reading-photo/recognize/route.ts",f.mocks);const result=await recognize.POST(request({...target,url:photo}));assert.equal(result.status,503);assert.equal((await result.json()).errorCode,"equipmentFill.photo.recognizeError");
});
test("response descriptors use current canonical locale, reject malformed parameters and retain literal decision notes",async()=>{
  assert.deepEqual(qrResponseFeedback({error:"RAW"},"reading.saveError"),{key:"reading.saveError"});
  assert.deepEqual(qrResponseFeedback({errorCode:"equipmentFill.errors.pinWrong",errorParams:{attempts:"bad"}},"reading.saveError"),{key:"reading.saveError"});
  for(const locale of ["ru","en","uz"] as const){const messages=await loadMessages(locale);for(const data of [{errorCode:"equipmentFill.errors.pinWrong",errorParams:{attempts:3}},{errorCode:"equipmentFill.pin.rejected",errorParams:{hasNote:"yes",note:"Customer note <&>"}}]){const descriptor=qrResponseFeedback(data,"reading.saveError");const t=createTranslator({locale,messages:messages.equipmentFill});const text=createTranslator({locale,messages:{message:t.raw(descriptor.key)}})("message",descriptor.values);assert.ok(!text.includes("MISSING"));if(data.errorParams.note)assert.ok(text.includes(data.errorParams.note));}}
});
