// Смоук «Не показывать клиентам информацию о консультанте».
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/qr-access-uv-partner-2026-09/e2e/smoke-partner-hidden.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8")
);
const ORG_A = "e2e-org-a";
const BRAND = "Смоук Консалт";
const SLUG = "smoke-consult";

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};

async function login(page: Page, email: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240_000 });
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.fill("#email", email);
    await page.fill("#password", state.password);
    await page.click('button[type="submit"]').catch(() => null);
    const left = await page
      .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    if (left) return;
  }
  throw new Error("login failed");
}

async function main() {
  const ownerId = state.users.managerB.id as string;
  await db.partner.deleteMany({ where: { slug: SLUG } });
  const partner = await db.partner.create({
    data: {
      slug: SLUG,
      code: "SMK123",
      status: "active",
      type: "consultant",
      companyName: "ООО Смоук",
      inn: "7700000000",
      city: "Москва",
      phone: "+79990000000",
      contactEmail: "smoke-partner@e2e.local",
      termsAcceptedAt: new Date(),
      applicantUserId: ownerId,
      onboardingDoneAt: new Date(),
      members: { create: { userId: ownerId, role: "owner" } },
      branding: { create: { brandName: BRAND, supportPhone: "+7 999 111-22-33" } },
      clients: { create: { organizationId: ORG_A, accessLevel: "view", source: "manual" } },
    },
    select: { id: true },
  });

  const browser = await chromium.launch({ channel: "chrome" });
  const clientCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const partnerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const anonCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const client = await clientCtx.newPage();
  const partnerPage = await partnerCtx.newPage();
  try {
    await login(client, state.users.managerA.email);
    await login(partnerPage, state.users.managerB.email);

    // До скрытия клиент видит консультанта.
    const before = (await (await clientCtx.request.get(`${BASE}/api/settings/consultant`)).json()) as { consultant?: { brandName?: string } };
    check("до скрытия: клиент видит бренд консультанта", before.consultant?.brandName === BRAND, before);

    // Партнёр включает «Не отображать» в кабинете.
    await partnerPage.goto(`${BASE}/partner/branding`, { waitUntil: "load", timeout: 240_000 });
    await partnerPage.getByTestId("partner-hide-from-clients").click();
    await partnerPage.getByRole("button", { name: "Скрыть" }).click();
    await partnerPage.getByText("Клиенты больше не видят информацию о консультанте").waitFor({ timeout: 30_000 });
    await partnerPage.screenshot({ path: path.join(SHOTS, "10-partner-visibility-card.png") });
    const saved = await db.partner.findUniqueOrThrow({ where: { id: partner.id }, select: { hideFromClients: true } });
    check("партнёр включил «Не отображать» — сохранено", saved.hideFromClients === true);

    // Кэш брендинга — в процессе dev-сервера: сброшен тем же запросом.
    const after = (await (await clientCtx.request.get(`${BASE}/api/settings/consultant`)).json()) as { consultant?: { brandName?: string; hidden?: boolean; supportPhone?: string | null } };
    check(
      "клиент в настройках видит «Службу сопровождения WeSetup», без контактов",
      after.consultant?.brandName === "Служба сопровождения WeSetup" && after.consultant?.hidden === true && !after.consultant?.supportPhone,
      after
    );

    await client.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 240_000 });
    await client.waitForLoadState("networkidle").catch(() => null);
    const dashboardHtml = await client.content();
    check("на дашборде клиента нет ни бренда, ни телефона консультанта", !dashboardHtml.includes(BRAND) && !dashboardHtml.includes("111-22-33"));

    await client.goto(`${BASE}/settings/consultant`, { waitUntil: "load", timeout: 240_000 });
    await client.getByText("Служба сопровождения WeSetup").first().waitFor({ timeout: 60_000 });
    const settingsText = await client.locator("main").innerText();
    await client.screenshot({ path: path.join(SHOTS, "11-client-consultant-hidden.png") });
    check("страница «Консультант» клиента: нейтрально, можно отключить", !settingsText.includes(BRAND) && settingsText.includes("Отключить"), settingsText.slice(0, 300));

    const lookup = (await (await anonCtx.request.get(`${BASE}/api/partners/lookup?slug=${SLUG}`)).json()) as { partner?: { brandName?: string; supportPhone?: string | null } };
    check("публичный lookup ссылки партнёра — без бренда", lookup.partner?.brandName === "Служба сопровождения WeSetup" && !lookup.partner?.supportPhone, lookup);

    const anon = await anonCtx.newPage();
    await anon.goto(`${BASE}/p/${SLUG}`, { waitUntil: "load", timeout: 240_000 });
    const landing = await anon.content();
    await anon.screenshot({ path: path.join(SHOTS, "12-partner-landing-hidden.png"), fullPage: true });
    check("страница /p/<slug> — без бренда и телефона партнёра", !landing.includes(BRAND) && !landing.includes("111-22-33"));

    const invites = (await (await partnerCtx.request.get(`${BASE}/api/partner/invites`)).json()) as { texts?: { long?: string } };
    check("готовые тексты приглашений — без «консультанта»", Boolean(invites.texts?.long) && !/консультант|нашей ссылке/i.test(invites.texts?.long ?? ""), invites.texts?.long);

    // Партнёр в своём кабинете по-прежнему видит свой бренд.
    await partnerPage.goto(`${BASE}/partner`, { waitUntil: "load", timeout: 240_000 });
    check("кабинет партнёра — со своим брендом", (await partnerPage.content()).includes(BRAND));

    // Выключили — клиент снова видит.
    const off = await partnerCtx.request.patch(`${BASE}/api/partner/visibility`, { data: { hideFromClients: false } });
    const back = (await (await clientCtx.request.get(`${BASE}/api/settings/consultant`)).json()) as { consultant?: { brandName?: string } };
    check("выключили — клиент снова видит консультанта", off.status() === 200 && back.consultant?.brandName === BRAND, back);
  } finally {
    await browser.close();
    await db.partner.deleteMany({ where: { id: partner.id } });
    fs.writeFileSync(path.join(HERE, "smoke-partner-hidden.json"), JSON.stringify(checks, null, 2));
    await db.$disconnect();
  }
  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
