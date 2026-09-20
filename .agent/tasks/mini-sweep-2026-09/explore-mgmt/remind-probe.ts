import { chromium } from "playwright";
import { state, db, BASE } from "../tg-session";
async function main() {
  const noTg = await db.user.findFirst({ where: { organizationId: "e2e-org-a", telegramChatId: null, isActive: true, archivedAt: null }, select: { id: true, name: true, email: true } });
  console.log("без Telegram:", JSON.stringify(noTg));
  const br = await chromium.launch({ headless: true });
  const ctx = await br.newContext();
  await ctx.request.post(BASE + "/api/auth/login", { data: { email: (state as any).users[process.argv[2]||"managerA"].email, password: (state as any).password } });
  const r = await ctx.request.post(BASE + "/api/control-board/remind", { data: { userIds: [noTg!.id], scopeLabel: "Проверка QA" }, failOnStatusCode: false });
  console.log("ответ:", r.status(), await r.text());
  const r2 = await ctx.request.post(BASE + "/api/control-board/remind", { data: { userIds: ["cmu2stndb000bwk9m3uwt4bs7"], scopeLabel: "чужой" }, failOnStatusCode: false });
  console.log("чужая орг:", r2.status(), await r2.text());
  await br.close(); await db.$disconnect();
}
main().catch(e=>{console.error(e);process.exit(1)});
