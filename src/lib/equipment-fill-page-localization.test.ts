/* eslint-disable react/no-children-prop -- typed SSR providers receive children as props. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import { EmployeePicker } from "@/components/qr-fill/employee-picker";
import { QrPinStep } from "@/components/qr-fill/qr-pin-step";
import { QrFillPresentationProvider } from "@/components/qr-fill/qr-fill-presentation";

async function fixture(input: { uv?: boolean; cookie?: string; personal?: Locale | null; authenticated?: boolean; orgLocale?: string; invalid?: boolean; authMode?: boolean; customTitle?: string; unrelatedControlOnly?: boolean }) {
  const require = createRequire(import.meta.url), calls: string[] = [];
  const source = ts.transpileModule(readFileSync("src/app/equipment-fill/[equipmentId]/page.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  const employee = { id: "person", name: "Customer O‘tkir", role: "cook", positionTitle: "Customer position", qrPinHash: null, canManageSettings: false, jobPosition: null };
  vm.runInNewContext(source, { module: mod, exports: mod.exports, console, Date, require: (id: string) => {
    if(id==="next/navigation") return { notFound:()=>{throw Error("not-found");},redirect:(url:string)=>{throw Error(`redirect:${url}`);} };
    if(id==="next/headers")return {cookies:async()=>({get:()=>input.cookie?{value:input.cookie}:undefined})};
    if(id==="@/lib/auth")return {authOptions:{}};
    if(id==="@/lib/server-session")return {getServerSession:async()=>input.authenticated?{user:{id:"viewer",locale:input.personal,organizationLocale:"ru",organizationId:"unrelated"}}:null};
    if(id==="@/i18n/site-locale-server")return {getSiteLocale:async()=>input.cookie??"ru"};
    if(id==="@/lib/equipment-qr-token")return {verifyEquipmentQrToken:()=>input.invalid?{ok:false,reason:"invalid"}:{ok:true,equipmentId:"equipment"}};
    if(id==="@/lib/db")return {db:{equipment:{findUnique:async()=>{calls.push("equipment");return {id:"equipment",name:"Customer freezer",type:input.uv?"uv_lamp":"freezer",tempMin:0,tempMax:8,fillerUserIds:[],sensorMappings:[],area:{id:"area",name:"Customer area",organizationId:"verified-org",organization:{name:"Customer organization",timezone:"Asia/Tashkent",qrFillMode:input.authMode?"auth":"public",locale:input.orgLocale??"uz"}}};}},user:{findMany:async(query:{where:{organizationId:string}})=>{assert.equal(query.where.organizationId,"verified-org");return [employee];}}}};
    if(id==="@/lib/org-custom-names")return {getOrgCustomNames:async(org:string)=>{assert.equal(org,"verified-org");calls.push("custom");return {journals:input.customTitle?{cold_equipment_control:input.customTitle,[input.unrelatedControlOnly?"uv_lamp_control":"uv_lamp_runtime"]:input.customTitle}:{},sections:{}};}};
    if(id==="@/lib/qr-fill-actor")return {normalizeQrFillMode:(value:string)=>value,sessionEmployeeForQr:async()=>({ok:false,reason:"no-session"})};
    if(id==="@/lib/qr-object-pass")return {passEmployeeIdFromCookie:async()=>null};
    if(id==="@/lib/qr-remember")return {readRememberValue:()=>null,rememberCookieName:()=>"remember"};
    if(id==="@/lib/equipment-fill-targets")return {resolveEquipmentFillTargets:async()=>({hasActiveDocument:true,climate:null})};
    if(id==="@/lib/qr-fill-siblings")return {listEquipmentSiblings:async()=>[]};
    if(id==="@/lib/uv-lamp-runs")return {listLampOperators:async()=>[employee],lampState:async()=>({running:null,lifetimeHours:100,usedHours:3,remainingHours:97})};
    if(id==="@/lib/plan-limits.server")return {hasPaidPlan:async()=>false};
    if(id==="@/lib/reading-photo-fixation.server")return {getReadingPhotoSettings:async()=>({enabled:false,required:false})};
    if(id.startsWith("./"))return require(`@/app/equipment-fill/[equipmentId]/${id.slice(2)}`);
    return require(id);
  }});
  const tree=await (mod.exports as {default:(props:unknown)=>Promise<ReactNode>}).default({params:Promise.resolve({equipmentId:"equipment"}),searchParams:Promise.resolve({token:"fixture-token"})});
  const router={back(){},forward(){},refresh(){},push(){},replace(){},prefetch:async()=>{}};
  return {html:renderToStaticMarkup(createElement(AppRouterContext.Provider,{value:router,children:tree})),calls};
}

test("actual equipment and UV pages resolve personal/cookie/verified-org locale without session-org leakage",async()=>{
  const errors:string[]=[],originalError=console.error;console.error=(...args:unknown[])=>errors.push(args.map(String).join(" "));
  try {
  for(const uv of [false,true])for(const choice of [
    {cookie:"en",expected:"en"},{cookie:"invalid",expected:"uz"},{expected:"uz"},{orgLocale:"bad",expected:"ru"},
    {authenticated:true,personal:"en" as const,cookie:"ru",expected:"en"},
    {authenticated:true,personal:null,cookie:"en",expected:"uz"},
  ]){const result=await fixture({uv,...choice});const messages=await loadMessages(choice.expected as Locale);assert.ok(result.html.includes(uv?messages.equipmentFill.uv.title:messages.equipmentFill.page.journalTitle));assert.ok(result.html.includes("Customer freezer"));assert.ok(result.html.includes("Customer organization"));assert.ok(!result.html.includes("MISSING_MESSAGE"));}
  assert.deepEqual(errors,[],"Actual page SSR must not emit next-intl environment or missing-message errors");
  } finally {console.error=originalError;}
});
test("verified organization custom journal titles take precedence for both branches in every locale",async()=>{
  for(const uv of [false,true])for(const cookie of ["ru","en","uz"]){const result=await fixture({uv,cookie,customTitle:"Customer original journal"});assert.ok(result.html.includes("Customer original journal"));}
});
test("invalid sticker never reads equipment/organization and auth redirect preserves the token URL",async()=>{
  const result=await fixture({invalid:true,cookie:"en"});assert.deepEqual(result.calls,[]);assert.ok(result.html.includes((await loadMessages("en")).equipmentFill.page.invalidTitle));
  await assert.rejects(fixture({authMode:true}),/redirect:\/login\?next=%2Fequipment-fill%2Fequipment%3Ftoken%3Dfixture-token/);
});
test("unrelated UV control journal customization cannot override runtime journal title",async()=>{
  for(const cookie of ["ru","en","uz"] as const){const result=await fixture({uv:true,cookie,customTitle:"Unrelated control journal",unrelatedControlOnly:true});assert.ok(!result.html.includes("Unrelated control journal"));assert.ok(result.html.includes((await loadMessages(cookie)).equipmentFill.uv.title));}
});
test("shared QR children render RU without an opt-in provider and localized PIN/employee copy when scoped",async()=>{
  const employees=[{id:"person",name:"Customer name",position:"Customer job"}];
  const child=createElement(EmployeePicker,{employees,value:"",onChange:()=>{}});
  assert.ok(renderToStaticMarkup(child).includes("Кто снимает показания"));
  for(const locale of ["ru","en","uz"] as const){const messages=await loadMessages(locale);const tree=createElement(QrFillPresentationProvider,{locale,messages:messages.equipmentFill,children:createElement(QrPinStep,{kind:"equipment",objectId:"equipment",token:"fixture",employeeId:"person",employeeName:"Customer name",hasPin:false,remember:true,onPass:()=>{}})});const html=renderToStaticMarkup(tree);assert.ok(html.includes(messages.equipmentFill.pin.requestAccess));assert.ok(html.includes(messages.equipmentFill.pin.personalRequired));}
});
