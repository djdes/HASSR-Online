/* eslint-disable react/no-children-prop -- typed SSR providers receive children as props. */
import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import vm from "node:vm";
import ts from "typescript";
import {createElement,type ComponentType,type ReactNode} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createTranslator} from "use-intl/core";
import {QrPinNoAccess} from "@/components/qr-fill/qr-pin-request";
import {QrFillPresentationProvider} from "@/components/qr-fill/qr-fill-presentation";
import {loadMessages} from "@/i18n/messages";
import type {Locale} from "@/i18n/locales";
import type {PinRequestStatusLine} from "@/lib/qr-object-pin-request";

const target={kind:"equipment" as const,objectId:"fixture",token:"fixture",employeeId:"fixture"};
async function scoped(locale:Locale,children:ReactNode){return renderToStaticMarkup(createElement(QrFillPresentationProvider,{locale,messages:(await loadMessages(locale)).equipmentFill,children}));}
function statusTree(status:PinRequestStatusLine){return createElement(QrPinNoAccess,{target,status,onStatus:()=>{}});}
function approvalTree(approvedMessageCode?:string){
 const require=createRequire(import.meta.url),mod={exports:{}};
 const source=ts.transpileModule(readFileSync("src/components/qr-fill/qr-pin-step.tsx","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 vm.runInNewContext(source,{module:mod,exports:mod.exports,require:(id:string)=>id==="@/components/qr-fill/qr-pin-request"?{...require(id),useQrPinRequestInfo:()=>[{hasPin:true,status:null,approvedNote:"RAW_SERVER_APPROVAL",approvedMessageCode},()=>{}]}:require(id)});
 const component=(mod.exports as {QrPinStep:ComponentType<Record<string,unknown>>}).QrPinStep;
 return createElement(component,{...target,employeeName:"Customer original",hasPin:true,remember:true,onPass:()=>{}});
}
for(const locale of ["ru","en","uz"] as const){
 test(`${locale}: scoped missing/unknown/malformed PIN status preserves rejection tone without raw prose`,async()=>{
  const messages=(await loadMessages(locale)).equipmentFill,t=createTranslator({locale,messages});
  for(const tone of ["wait","bad"] as const)for(const descriptor of [{},{messageCode:"unknown.status"},{messageCode:"equipmentFill.pin.unknown"},{messageCode:"equipmentFill.pin.rejected"},{messageCode:"equipmentFill.pin.rejected",messageParams:{hasNote:"yes"}}]){
   const html=await scoped(locale,statusTree({tone,text:"RAW_SERVER_STATUS",...descriptor}));
   assert.ok(!html.includes("RAW_SERVER_STATUS"));assert.ok(html.includes(tone==="bad"?t("pin.rejected",{hasNote:"no",note:""}):messages.pin.pending));assert.ok(html.includes(tone==="bad"?'class="qp-err"':'class="qp-ok-note"'));assert.ok(!html.includes("MISSING"));
  }
 });
 test(`${locale}: scoped approval has localized fallback and keeps valid change-approval descriptor`,async()=>{
  const messages=(await loadMessages(locale)).equipmentFill;
  for(const code of [undefined,"unknown.approved","equipmentFill.pin.unknown","equipmentFill.pin.rejected"]){const html=await scoped(locale,approvalTree(code));assert.ok(html.includes(messages.pin.approved));assert.ok(!html.includes("RAW_SERVER_APPROVAL"));}
  assert.ok((await scoped(locale,approvalTree("equipmentFill.pin.changeApproved"))).includes(messages.pin.changeApproved));
 });
 test(`${locale}: structured rejection note remains literal and escaped`,async()=>{
  const html=await scoped(locale,statusTree({tone:"bad",text:"RAW_SERVER_STATUS",messageCode:"equipmentFill.pin.rejected",messageParams:{hasNote:"yes",note:"Customer original <&> note"}}));assert.ok(html.includes("Customer original &lt;&amp;&gt; note"));assert.ok(!html.includes("RAW_SERVER_STATUS"));
 });
}
test("unscoped shared callers retain their original Russian compatibility status and approval text",()=>{
 for(const tone of ["wait","bad"] as const)assert.ok(renderToStaticMarkup(statusTree({tone,text:"Legacy original status"})).includes("Legacy original status"));
 assert.ok(renderToStaticMarkup(approvalTree()).includes("RAW_SERVER_APPROVAL"));
});
