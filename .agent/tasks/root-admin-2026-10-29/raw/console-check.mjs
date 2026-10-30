import { chromium } from "playwright";
const BASE="http://localhost:3026";
const b = await chromium.launch({ executablePath: "C:/Users/Two/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage(); p.setDefaultTimeout(120000);
const errs=[]; p.on("console", m => { if (m.type()==="error"||m.type()==="warning") errs.push(m.type()+": "+m.text().slice(0,300)); });
await p.goto(BASE+"/login");
for (let i=0;i<6;i++){ await p.fill("#email","root@test.local"); await p.fill("#password","Test-12345"); if((await p.inputValue("#email"))!=="root@test.local") continue; await p.click('button[type="submit"]'); try{ await p.waitForURL(u=>!u.pathname.startsWith("/login"),{timeout:30000}); break;}catch{} }
for (const path of ["/root/team","/root","/root/organizations/org-dk","/root/me"]) { errs.length=0; await p.goto(BASE+path); await p.waitForTimeout(4000); console.log(path, JSON.stringify(errs.filter(e=>!/timeZone|Download the React DevTools|Fast Refresh/.test(e)))); }
await b.close();
