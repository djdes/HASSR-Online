import assert from "node:assert/strict";
import test from "node:test";
import {
  formatOrderAttribution,
  formatOrderStatusBadge,
  formatRub,
  formatSlotStatusBadge,
  sanitizeArticleHtmlForPreview,
} from "@/lib/seo/gogetlinks-ui-format";

test("formatOrderAttribution renders transparent Russian labels for manual, scheduled and external GGL orders", () => {
  const scheduled = formatOrderAttribution({
    origin: "scheduled_wesetup",
    initiatedByName: "Анна",
    approvedByName: "Олег",
  });
  assert.equal(scheduled.primary, "По плану · подтв. Олег");
  assert.equal(scheduled.secondary, "План подготовил(а): Анна");
  assert.equal(scheduled.badgeTone, "indigo");

  const manual = formatOrderAttribution({
    origin: "manual_wesetup",
    initiatedByName: "Олег",
    approvedByName: "Олег",
  });
  assert.equal(manual.primary, "Олег (вручную)");
  assert.equal(manual.badgeTone, "emerald");

  const external = formatOrderAttribution({
    origin: "external_ggl",
    initiatedByName: null,
    approvedByName: null,
  });
  assert.equal(external.primary, "Из кабинета GoGetLinks");
  assert.equal(external.badgeTone, "slate");
});

test("formatSlotStatusBadge maps slot lifecycle statuses to Russian labels and tones", () => {
  assert.deepEqual(formatSlotStatusBadge("pending_approval"), {
    label: "Ждёт подтверждения",
    badgeTone: "amber",
  });
  assert.deepEqual(formatSlotStatusBadge("ordered"), {
    label: "Заявка отправлена",
    badgeTone: "emerald",
  });
  assert.deepEqual(formatSlotStatusBadge("skipped"), {
    label: "Пропущен",
    badgeTone: "slate",
  });
  assert.deepEqual(formatSlotStatusBadge("failed"), {
    label: "Ошибка подбора",
    badgeTone: "rose",
  });
});

test("formatOrderStatusBadge maps placement statuses to Russian labels and tones", () => {
  assert.deepEqual(formatOrderStatusBadge("on_check"), {
    label: "На проверке",
    badgeTone: "amber",
  });
  assert.deepEqual(formatOrderStatusBadge("in_progress"), {
    label: "В работе",
    badgeTone: "indigo",
  });
  assert.deepEqual(formatOrderStatusBadge("paid"), {
    label: "Оплачено",
    badgeTone: "emerald",
  });
  assert.deepEqual(formatOrderStatusBadge("needs_replacement"), {
    label: "На замену",
    badgeTone: "rose",
  });
  assert.deepEqual(formatOrderStatusBadge("rejected"), {
    label: "Отклонено",
    badgeTone: "slate",
  });
});

test("formatRub formats integer and fractional ruble amounts cleanly", () => {
  assert.equal(formatRub(0), "0 ₽");
  assert.equal(formatRub(null), "0 ₽");
  assert.equal(formatRub(10000).replace(/\u00a0/g, " "), "10 000 ₽");
  assert.equal(formatRub(1450.5).replace(/\u00a0/g, " "), "1 450,5 ₽");
});

test("sanitizeArticleHtmlForPreview strips scripts, iframes, inline event handlers and javascript URLs", () => {
  const dirty =
    '<h2>Нормы ХАССП</h2><script>alert(1)</script><p onclick="evil()">Проверьте <a href="https://wesetup.ru/journals-info" onmouseover="steal()">журнал бракеража</a> и <a href="javascript:alert(2)">вред</a>.</p><iframe src="https://evil.test"></iframe>';
  const clean = sanitizeArticleHtmlForPreview(dirty);
  assert.equal(clean.includes("<script"), false);
  assert.equal(clean.includes("<iframe"), false);
  assert.equal(clean.includes("onclick"), false);
  assert.equal(clean.includes("onmouseover"), false);
  assert.equal(clean.includes("javascript:"), false);
  assert.equal(clean.includes('href="https://wesetup.ru/journals-info"'), true);
  assert.equal(clean.includes("журнал бракеража"), true);
});
