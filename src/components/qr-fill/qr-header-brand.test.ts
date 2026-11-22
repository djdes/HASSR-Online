import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { qrPageBrand } from "@/lib/qr-page-brand";
import {
  QrHeaderMark,
  WESETUP_QR_HEADER_BACKGROUND,
  qrAccentRootProps,
  qrHeaderBackground,
} from "./qr-header-brand";

/*
 * Фирменный стиль везде (2026-11-21): страницы сотрудников по QR — в цвете и
 * с логотипом компании, кабинет — в её цвете по переключателю.
 */

const read = (file: string) => readFileSync(file, "utf8");

test("шапка QR-страницы: без стиля — WeSetup, с цветом — градиент цвета компании", () => {
  assert.equal(qrHeaderBackground(null), WESETUP_QR_HEADER_BACKGROUND);
  const brand = qrPageBrand({ logoUrl: null, brandColor: "#1f3a8a" });
  assert.match(qrHeaderBackground(brand), /linear-gradient\(135deg, #1f3a8a, #[0-9a-f]{6}\)/);
  assert.deepEqual(qrAccentRootProps(null), {});
  const props = qrAccentRootProps(brand);
  assert.equal(props["data-partner-accent"], "");
  assert.equal(props["data-qr-brand"], "");
  assert.equal((props.style as Record<string, string>)["--brand-accent"], "#1f3a8a");
  // Только логотип — акцента нет, кнопки остаются WeSetup.
  assert.deepEqual(qrAccentRootProps(qrPageBrand({ logoUrl: "/api/org-assets/o1/logo?v=1", brandColor: null })), { "data-qr-brand": "" });
});

test("знак в шапке: логотип на белой плашке, иначе значок QR", () => {
  const withLogo = renderToStaticMarkup(createElement(QrHeaderMark, { logoUrl: "/api/org-assets/o1/logo?v=1" }));
  assert.match(withLogo, /data-qr-logo/);
  assert.match(withLogo, /<img[^>]+src="\/api\/org-assets\/o1\/logo\?v=1"/);
  const plain = renderToStaticMarkup(createElement(QrHeaderMark, { logoUrl: null }));
  assert.doesNotMatch(plain, /<img/);
  assert.match(plain, /lucide-qr-code/);
});

test("все страницы сотрудников по QR получают стиль компании", () => {
  assert.match(read("src/components/qr-fill/qr-page-shell.tsx"), /qrHeaderBackground\(brand\)[\s\S]*<QrHeaderMark logoUrl=\{brand\?\.logoUrl \?\? null\} \/>/);
  const equipment = read("src/app/equipment-fill/[equipmentId]/page.tsx");
  assert.match(equipment, /organization: \{ select: \{[^}]*logoUrl: true, brandColor: true \} \}/);
  assert.equal((equipment.match(/brand=\{qrPageBrand\(equipment\.area\.organization\)\}/g) ?? []).length, 3);
  for (const client of ["equipment-fill-client", "uv-lamp-client", "fryer-fill-client"]) {
    assert.match(read(`src/app/equipment-fill/[equipmentId]/${client}.tsx`), /<QrPageShell [^>]*brand=\{(props\.)?brand\}>/, client);
  }
  assert.match(read("src/app/room-fill/[roomId]/page.tsx"), /brand: qrPageBrand\(room\.building\.organization\)/);
  assert.match(read("src/app/room-fill/[roomId]/room-fill-client.tsx"), /brand=\{room\.brand\}/);
  assert.match(read("src/app/q/[token]/page.tsx"), /brand=\{qrPageBrand\(resolved\.user\.organization\)\}/);
  assert.match(read("src/lib/personal-login.ts"), /organization: \{ select: \{ name: true, logoUrl: true, brandColor: true \} \}/);
});

test("правила акцента — и для кабинета, и для QR-страниц, без изменения специфичности", () => {
  const css = read("src/app/app-theme.css");
  // Кнопки, ссылки, рамки, подложки и тумблеры — общими правилами; только кабинетные
  // (значок платформы, карточка «Начальная настройка») остаются у `.app-shell`.
  assert.doesNotMatch(css, /^\.app-shell\[data-partner-accent\] \.(bg|text|border|hover|focus|data)/m);
  // `:where(:not(:disabled))` — неактивную кнопку не перекрашиваем, специфичность та же (2026-11-22).
  assert.match(css, /^:is\(\.app-shell, \[data-qr-brand\]\)\[data-partner-accent\] \.bg-\\\[\\#5566f6\\\]:where\(:not\(:disabled\)\) \{/m);
});

test("кабинет в цветах компании — только по переключателю, цвет компании важнее партнёра", () => {
  const layout = read("src/app/(dashboard)/layout.tsx");
  assert.match(layout, /brandCabinet: true/);
  assert.match(layout, /const ownAccent = brandedOrg\?\.brandCabinet \? brandAccent\(brandedOrg\.brandColor\) : null;/);
  assert.match(layout, /const cabinetAccent = ownAccent \? \{ color: ownAccent\.accent, hover: ownAccent\.hover \} : partnerAccent;/);
  assert.match(layout, /data-partner-accent=\{cabinetAccent \? "" : undefined\}/);
});

test("«Фирменный стиль»: подбор по логотипу, сам после загрузки, переключатель кабинета, превью телефона", () => {
  const form = read("src/components/settings/organization-branding-form.tsx");
  assert.match(form, /onClick=\{\(\) => void pickColorsFromLogo\(logoUrl\)\}/);
  assert.match(form, /if \(url && nothingChosen\) void pickColorsFromLogo\(url, true\);/);
  assert.match(form, /testId="brand-cabinet"/);
  assert.match(form, /payload\.brandCabinet = draft\.brandCabinet/);
  assert.match(form, /<QrPagePreview brand=\{qrPage\}/);
  assert.match(form, /<CabinetPreview accent=\{cabinetAccent\} \/>/);
  assert.match(read("src/app/(dashboard)/settings/organization/branding/page.tsx"), /brandCabinet: org\.brandCabinet/);
  assert.match(read("prisma/schema.prisma"), /^\s+brandCabinet\s+Boolean\s+@default\(false\)$/m);
});

test("шаг PIN, «Запомнить выбор» и галка «Записано» — в цвете компании, без него — индиго WeSetup", () => {
  const css = read("src/lib/qr-pin-ui.ts");
  assert.match(css, /background:var\(--brand-accent,\$\{QR_CHECK_COLOR\}\)/);
  assert.match(css, /\.qp-remember input\{[^}]*accent-color:var\(--brand-accent,#5566f6\)/);
  assert.match(css, /\.qp-pin:focus\{[^}]*border-color:var\(--brand-accent,#5566f6\)/);
  // Ореол: сначала rgba (браузер без color-mix), потом цвет компании.
  assert.match(css, /box-shadow:0 0 0 10px rgba\(85,102,246,\.14\);box-shadow:0 0 0 10px color-mix\(/);
});
