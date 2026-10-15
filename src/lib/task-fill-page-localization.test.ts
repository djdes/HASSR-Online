/* eslint-disable react/no-children-prop -- next-intl provider requires children in typed SSR props. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import { mintTaskFillToken } from "@/lib/task-fill-token";
import type { Locale } from "@/i18n/locales";

async function pageFixture(input: { kind?: string; cookie?: string; personal?: string | null; authenticated?: boolean; validToken?: boolean }) {
  const require = createRequire(import.meta.url);
  const calls: Array<{ type: string; id: string }> = [];
  const source = ts.transpileModule(readFileSync("src/app/task-fill/[taskId]/page.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const fixtureModule = { exports: {} };
  const candidates = ["wrong-secret", "correct-secret"].map((webhookSecret, i) => ({
    kind: input.kind ?? "filler", journalCode: "custom", journalDocumentId: `doc-${i}`, rowKey: "employee-user", remoteStatus: "active",
    integration: { webhookSecret, organizationId: `org-${i}` },
  }));
  vm.runInNewContext(source, {
    module: fixtureModule, exports: fixtureModule.exports, Date, console,
    require: (id: string) => {
      if (id === "next/navigation") return { notFound: () => { throw new Error("Not found"); } };
      if (id === "next/headers") return { cookies: async () => ({ get: () => input.cookie ? { value: input.cookie } : undefined }) };
      if (id === "@/lib/server-session") return { getServerSession: async () => input.authenticated ? { user: { locale: input.personal } } : null };
      if (id === "@/lib/auth") return { authOptions: {} };
      if (id === "next-intl/server") return { getTranslations: async ({locale,namespace}:{locale:Locale;namespace:never}) => createTranslator({ locale, messages: await loadMessages(locale), namespace }) };
      if (id === "@/lib/org-custom-names") return { getOrgCustomNames: async (org: string) => { calls.push({type:"customNames",id:org});return {journals:{custom:"Customer journal"},sections:{}}; } };
      if (id === "@/lib/tasksflow-adapters") return { getAdapter: () => ({ getTaskForm: async () => ({ fields: [{ key: "custom-key", label: "Customer field", type: "text" }] }) }) };
      if (id === "@/lib/journal-close-events") return { getActiveCloseEvent: async () => null, documentBuildingId: async () => "building", utcDayStart: (date:Date) => new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())) };
      if (id === "@/lib/db") return { db: {
        tasksFlowTaskLink: { findMany: async (query:{where:{kind?:string}}) => query.where.kind ? [] : candidates },
        organization: { findUnique: async ({where}:{where:{id:string}}) => {calls.push({type:"organization",id:where.id});return {locale:"uz",requireAdminForJournalEdit:false};} },
        journalDocument: { findUnique: async ({where}:{where:{id:string}}) => {calls.push({type:"document",id:where.id});return {id:where.id,title:"Customer document O‘tkir",verifierUserId:null,verificationStatus:null,verificationRejectReason:null,template:{code:"custom",name:"Custom journal",fields:[{key:"custom-key",label:"Customer field"}]}};} },
        journalDocumentEntry: { findMany: async () => [{id:"entry",date:new Date("2026-10-15T23:30:00Z"),data:{"custom-key":"Customer value O‘tkir"},employee:{name:"Customer employee"},verificationStatus:null}] },
        user: { findUnique: async () => ({id:"user",name:"Customer employee",role:"cook",positionTitle:null}) },
        journalTemplate: { findFirst: async () => ({id:"template",name:"Custom journal",taskScope:"personal",noEventsReasons:["Custom reason"],allowNoEvents:true,allowFreeTextReason:true}) },
      } };
      if (id.startsWith("./")) return require(`@/app/task-fill/[taskId]/${id.slice(2)}`);
      return require(id);
    },
  });
  const page = (fixtureModule.exports as { default: (input: unknown) => Promise<React.ReactNode> }).default;
  const tree = await page({ params: Promise.resolve({taskId:"51"}), searchParams: Promise.resolve({token:input.validToken===false?"invalid":mintTaskFillToken(51,"correct-secret"),return:"/safe-return"}) });
  return { html: renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "ru", messages: {}, timeZone: "UTC", onError: error => { throw error; }, children: tree })), calls };
}

test("actual token page supplies the selected locale to both flows and keeps organization isolation", async () => {
  for(const kind of ["filler","verifier"]){
    for(const choice of [
      {cookie:"en",expected:"en"}, {expected:"uz"},
      {authenticated:true,personal:"en",cookie:"ru",expected:"en"},
      {authenticated:true,personal:null,cookie:"en",expected:"uz"},
    ]){
      const result=await pageFixture({kind,...choice});const messages=await loadMessages(choice.expected as Locale);
      assert.ok(result.html.includes(kind==="verifier"?messages.taskFill.verify.title:messages.taskFill.form.completed));
      assert.ok(result.html.includes("Customer document O‘tkir"));
      assert.ok(result.html.includes("Customer employee"));
      assert.ok(result.calls.every(call=>!call.id.endsWith("-0")),"only the verified integration's tenant/document is read");
    }
  }
});

test("invalid token error uses guest locale without reading a candidate organization's locale or data", async () => {
  const result=await pageFixture({validToken:false,cookie:"en"});const messages=await loadMessages("en");
  assert.ok(result.html.includes(messages.taskFill.page.invalidLink));
  assert.ok(result.html.includes(messages.taskFill.page.damagedLink));
  assert.ok(result.html.includes(messages.taskFill.actions.return));
  assert.deepEqual(result.calls,[]);
});
