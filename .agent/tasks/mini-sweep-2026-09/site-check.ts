import fs from "node:fs"; import { chromium } from "playwright";
const state = JSON.parse(fs.readFileSync("D:/www/Wesetup.ru/.agent/tasks/journal-responsibles-org-2026-09/e2e/state.json","utf8"));
(async()=>{ const b=await chromium.launch({headless:true});
 for (const [name,vp,cookie] of [["desktop-nocookie",{width:1440,height:900},false],["desktop-cookie",{width:1440,height:900},true],["phone-nocookie",{width:390,height:800},false]] as any[]) {
  const ctx=await b.newContext({viewport:vp}); if(cookie) await ctx.addCookies([{name:"ws-shell",value:"mini",url:"http://localhost:3021"}]);
  const r=await ctx.request.post("http://localhost:3021/api/auth/login",{data:{email:state.users.ownerA.email,password:state.password},timeout:300000}); const p=await ctx.newPage(); let loads=0; p.on("load",()=>loads++);
  await p.goto("http://localhost:3021/dashboard",{waitUntil:"load",timeout:300000}); await p.waitForTimeout(5000);
  console.log(name, r.status(), JSON.stringify(await p.evaluate(`({path:location.pathname,mini:!!document.getElementById('mini-root'),footer:!!document.querySelector('footer'),cookie:document.cookie.includes('ws-shell')})`)), "loads", loads); await ctx.close(); }
 await b.close(); })();
