import assert from "node:assert/strict";
import { test } from "node:test";
import { maxJson } from "./http";
import { POST as webhook } from "@/app/api/max/webhook/route";

test("MAX webhook fails closed for missing, wrong or unconfigured secrets",async()=>{
  const original=process.env.MAX_WEBHOOK_SECRET;
  try {
    process.env.MAX_WEBHOOK_SECRET="test-webhook-secret";
    assert.equal((await webhook(new Request("https://wesetup.ru/api/max/webhook",{method:"POST"}))).status,403);
    assert.equal((await webhook(new Request("https://wesetup.ru/api/max/webhook",{method:"POST",headers:{"X-Max-Bot-Api-Secret":"wrong"}}))).status,403);
    process.env.MAX_WEBHOOK_SECRET="";
    assert.equal((await webhook(new Request("https://wesetup.ru/api/max/webhook",{method:"POST"}))).status,503);
  }finally{if(original===undefined) delete process.env.MAX_WEBHOOK_SECRET;else process.env.MAX_WEBHOOK_SECRET=original;}
});
test("MAX JSON actions reject cross-site requests and oversized/malformed bodies",async()=>{
  const req=(body:string,headers:Record<string,string>={})=>new Request("https://wesetup.ru/api/max/link",{method:"POST",headers:{"Content-Type":"application/json",...headers},body});
  await assert.rejects(()=>maxJson(req("{}",{Origin:"https://evil.test"})));
  await assert.rejects(()=>maxJson(req("{}",{"Content-Type":"text/plain"})));
  await assert.rejects(()=>maxJson(req("bad-json")));
  await assert.rejects(()=>maxJson(req("x".repeat(20_001))));
  assert.deepEqual(await maxJson(req('{"action":"create"}',{Origin:"https://wesetup.ru"})),{action:"create"});
});
