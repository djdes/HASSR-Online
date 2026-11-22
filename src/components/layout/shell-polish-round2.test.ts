/* eslint-disable react/no-children-prop -- Explicit provider children for SSR tests. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { loadMessages } from "@/i18n/messages";
import { LOCALES, OFFERED_LOCALES, type Locale } from "@/i18n/locales";
import { BrandHeaderAction, OrganizationBrand } from "./organization-brand";
import { CabinetPlanCardView } from "./cabinet-plan-card";
import { SetupStepper } from "@/components/dashboard/setup-wizard-steps";
import { TasksFlowPromoHint } from "@/components/tasksflow/tasksflow-promo-hint";

/*
 * Правки владельца по проду, 2026-11-22 (второй круг): состояния меню,
 * прокрутка листа, кнопка оформления в шапке меню, примеры в блоках
 * «Фирменного стиля», лист профиля, мастер после регистрации и окна
 * листом снизу на телефоне.
 */

const read = (file: string) => readFileSync(file, "utf8");
const router = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };

async function render(locale: Locale, node: ReactNode) {
  const messages = await loadMessages(locale);
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, {
      value: router,
      children: createElement(NextIntlClientProvider, {
        locale,
        messages,
        timeZone: "Europe/Moscow",
        onError: (error) => {
          throw error;
        },
        children: node,
      }),
    }),
  );
}

test("меню: у раздела страницы нет заливки — только тон и полоска; залита сама страница", () => {
  const classic = read("src/components/layout/app-sidebar-accordion-classic.tsx");
  assert.match(classic, /const ROW_PARENT = "text-\[var\(--tone-ink\)\] hover:bg-\[#f5f6ff\]";/);
  assert.match(classic, /: active \? \(section\.menu \? ROW_PARENT : ROW_ACTIVE\) : ROW_IDLE,/);
  // Пункт раскрытого списка по-прежнему залит.
  assert.match(classic, /: itemActive\s*\? ROW_ACTIVE/);
});

test("шапка меню: кнопка оформления слева — загрузить логотип или «Фирменный стиль»; на плитке — значок, не плашка", async () => {
  const messages = await loadMessages("ru");
  const upload = await render("ru", createElement(BrandHeaderAction, { logoUrl: null }));
  assert.match(upload, /data-brand-action="upload"/);
  assert.ok(upload.includes(`aria-label="${messages.navigation.shell.uploadLogo}"`));
  assert.match(upload, /type="file"/);
  assert.match(upload, /rounded-full bg-\[#f5f6ff\]/);
  const settings = await render("ru", createElement(BrandHeaderAction, { logoUrl: "/api/org-assets/o/logo?v=1" }));
  assert.match(settings, /data-brand-action="settings"/);
  assert.match(settings, /href="\/settings\/organization\/branding"/);
  assert.ok(settings.includes(`aria-label="${messages.navigation.shell.brandingSettings}"`));

  const tile = await render(
    "ru",
    createElement(OrganizationBrand, { logoUrl: null, name: "Ооо тест", identity: { name: "Ооо тест", inn: null }, homeHref: "/home", canEditBranding: true, large: true }),
  );
  // Значок загрузки — на углу плитки, без плашки, которая наезжала на заглушку.
  assert.match(tile, /data-logo-upload[^>]*class="[^"]*absolute -right-2 -bottom-2 [^"]*size-8/);
  assert.doesNotMatch(tile, /-mt-2\.5/);
  for (const locale of LOCALES) {
    const shell = (await loadMessages(locale)).navigation.shell;
    assert.ok(shell.brandingSettings.trim(), locale);
  }
});

test("«Фирменный стиль»: примеры в своих блоках, отдельного блока «Как это выглядит» нет", () => {
  const form = read("src/components/settings/organization-branding-form.tsx");
  assert.doesNotMatch(form, /n=\{5\}|brandingPage\.previewTitle/);
  const block = (n: number) => form.slice(form.indexOf(`<StepCard n={${n}}`), form.indexOf("</StepCard>", form.indexOf(`<StepCard n={${n}}`)));
  assert.match(block(2), /<WithPreview[\s\S]*<MonoSwitch[\s\S]*<PosterPreview[\s\S]*<CabinetPreview/);
  assert.match(block(3), /<WithPreview[\s\S]*<LabelPreview/);
  assert.match(block(4), /<WithPreview[\s\S]*<QrStickerPreview[\s\S]*<QrPagePreview/);
  // Широкий экран — поля и пример рядом, телефон — пример под полями.
  assert.match(form, /xl:grid-cols-\[minmax\(0,1fr\)_minmax\(0,340px\)\]/);
});

test("переключатели «Фирменного стиля» подписаны по текущему состоянию", async () => {
  const form = read("src/components/settings/organization-branding-form.tsx");
  assert.match(form, /hintOn=\{t\("brandingPage\.qrFrameHintOn"\)\}/);
  assert.match(form, /hintOn=\{t\("brandingPage\.qrCenterHintOn"\)\}/);
  assert.match(form, /\{checked && hintOn \? hintOn : hint\}/);
  for (const locale of LOCALES) {
    const page = (await loadMessages(locale)).settingsManagement.organizationProfile.brandingPage;
    assert.ok(page.qrFrameHintOn.trim() && page.qrCenterHintOn.trim(), locale);
    assert.notEqual(page.qrFrameHintOn, page.qrFrameHint, locale);
  }
});

test("лист профиля: почта один раз, язык справа от «Выйти», демо — под «Фирменным стилем»", () => {
  const sheet = read("src/components/layout/profile-sheet.tsx");
  assert.match(sheet, /subtitle=\{userEmail && userEmail !== userName \? userEmail : undefined\}/);
  const footer = sheet.slice(sheet.indexOf("footer={"), sheet.indexOf("      }\n    >"));
  assert.match(footer, /t\("header\.logout"\)[\s\S]*<PersonalLanguageSelect \/>/);
  // В теле листа второго выбора языка нет.
  assert.equal((sheet.match(/<PersonalLanguageSelect/g) ?? []).length, 1);
  assert.match(sheet, /demoEntry=\{false\}/);
  assert.ok(sheet.indexOf('data-testid="profile-open-demo"') > sheet.indexOf('data-testid="theme-branding-link"'));
});

test("тариф в меню профиля: «Тариф организации:», тариф и «Сменить» справа, без «Мой кабинет · сейчас»", async () => {
  for (const locale of LOCALES) {
    const messages = await loadMessages(locale);
    const html = await render(
      locale,
      createElement(CabinetPlanCardView, {
        card: { title: "Пробный период — по 28 ноября", counts: "1 точка · 2 сотрудника", price: null, link: { href: "/settings/subscription", label: "Выбрать тариф" } },
        variant: "sheet",
      }),
    );
    const card = messages.layoutUi.cabinetPlanCard;
    assert.ok(html.includes(card.label), locale);
    assert.match(html, /data-testid="cabinet-plan-change"[^>]*href="\/settings\/subscription"|href="\/settings\/subscription"[^>]*data-testid="cabinet-plan-change"/);
    assert.ok(html.includes(`>${card.change}<`), `${locale}: ${card.change}`);
    assert.ok(!html.includes(card.myCabinet) && !html.includes(`>${card.current}<`), locale);
    assert.match(html, /lucide-arrow-left-right/);
  }
});

test("языки: русский, английский и узбекский — во всех переключателях", () => {
  assert.deepEqual([...OFFERED_LOCALES], ["ru", "en", "uz"]);
});

test("мастер после регистрации: шаги — кнопки, до сохранения анкеты доступна только она", async () => {
  const html = await render(
    "ru",
    createElement(SetupStepper, { step: "profile", onSelect() {}, canSelect: (key: string) => key === "profile" }),
  );
  assert.equal((html.match(/data-setup-step-button=/g) ?? []).length, 4);
  // Текущий шаг и недоступные — неактивны.
  assert.equal((html.match(/disabled=""/g) ?? []).length, 4);
  const open = await render("ru", createElement(SetupStepper, { step: "points", onSelect() {} }));
  assert.equal((open.match(/disabled=""/g) ?? []).length, 1);

  const nudge = read("src/components/dashboard/complete-profile-nudge.tsx");
  assert.match(nudge, /setProfileSaved\(true\);/);
  assert.match(nudge, /canSelect=\{\(key\) => key === "profile" \|\| profileSaved\}/);
  assert.match(nudge, /onClick=\{step === "profile" && !profileSaved \? onClose : finishSetup\}/);
});

test("мастер на телефоне — лист снизу; пары полей поровну; TasksFlow — «авторегистрация»; подпись демо", async () => {
  const nudge = read("src/components/dashboard/complete-profile-nudge.tsx");
  assert.match(nudge, /className="fixed inset-0 z-\[60\] flex items-end justify-center [^"]*p-0 [^"]*sm:items-center sm:p-4"/);
  assert.match(nudge, /data-mobile-sheet[\s\S]{0,40}className="[^"]*rounded-t-3xl[^"]*max-sm:slide-in-from-bottom[^"]*sm:rounded-3xl/);
  assert.match(nudge, /<div className="grid grid-cols-2 items-stretch gap-2">/);
  assert.match(nudge, /: "col-span-2 border-\[#dcdfed\] bg-white py-3"/);
  assert.doesNotMatch(nudge, /grid-cols-\[minmax\(0,1fr\)_minmax\(0,1\.3fr\)\]/);
  assert.match(nudge, /<div className="grid gap-2 sm:grid-cols-2 sm:items-start">/);

  for (const locale of LOCALES) {
    const messages = await loadMessages(locale);
    const hint = await render(locale, createElement(TasksFlowPromoHint, { campaign: "register_nudge", compact: true }));
    assert.ok(hint.includes(messages.sharedUi.tasksflowPromoHint.autoRegister), locale);
    assert.doesNotMatch(hint, /WESETUP50|href=/);
  }
  const notes = await Promise.all(LOCALES.map(async (locale) => (await loadMessages(locale)).dashboardUi.completeProfileNudge.demoNote));
  assert.deepEqual(notes, ["Демо-организация, 7 дней", "Demo organisation, 7 days", "Demo tashkilot, 7 kun"]);
});

test("свои окна на телефоне — листом снизу, с 640px — по центру", () => {
  const files = [
    "src/components/layout/create-organization-dialog.tsx",
    "src/components/layout/create-demo-dialog.tsx",
    "src/components/master/create-master-cabinet-dialog.tsx",
    "src/components/master/master-access-dialog.tsx",
    "src/components/staff/staff-qr-invite-dialog.tsx",
    "src/components/dashboard/stale-capa-nag.tsx",
    "src/components/ui/prompt-async.tsx",
    "src/components/root/seo-links/OrdersRegistryTab.tsx",
    "src/app/root/blog/blog-admin-client.tsx",
  ];
  for (const file of files) {
    const source = read(file);
    assert.match(source, /fixed inset-0[^"]*flex items-end justify-center[^"]*sm:items-center/, file);
    assert.doesNotMatch(source, /fixed inset-0[^"]*(?<!sm:)items-center justify-center/, file);
    assert.match(source, /max-sm:rounded-t-3xl[^"]*max-sm:slide-in-from-bottom/, file);
    assert.match(source, /env\(safe-area-inset-bottom\)/, file);
  }
});
