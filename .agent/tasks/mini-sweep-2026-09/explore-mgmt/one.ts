import { chromium } from "playwright";
import { state, BASE } from "../tg-session";
async function main() {
  const [role, path] = process.argv.slice(2);
  const br = await chromium.launch({ headless: true });
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.request.post(BASE + "/api/auth/login", { data: { email: (state as any).users[role].email, password: (state as any).password } });
  const p = await ctx.newPage();
  await p.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(8000);
  console.log(role, path, "->", p.url().replace(BASE, ""), "|", await p.evaluate(`(function(){var h=document.querySelector("h1");return (h?h.innerText:"(нет h1)")})()`));
  await br.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
