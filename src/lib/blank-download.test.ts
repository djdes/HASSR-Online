import assert from "node:assert/strict";
import test from "node:test";

import {
  BLANK_CONSENT_PARTS,
  BLANK_CONSENT_TEXT,
  blankCabinetPath,
  blankFilePath,
  blankLoginHref,
  blankPagePath,
  blankRegisterHref,
  blankSignupPlace,
  blankTargetKey,
  normalizeBlankEmail,
  parseBlankTargetKey,
  readRememberedBlankEmail,
} from "@/lib/blank-download";
import { BLANK_LIMITS, createBlankDownloadLimiter } from "@/lib/blank-download-limits";
import { parseBlankDownloadRequest } from "@/lib/blank-download-targets";

/**
 * Шаблоны журналов после email (спека blanks-email-gate-2026-09):
 * общие помощники, разбор запроса на скачивание и лимиты.
 */

test("текст галки согласия: то, что видит человек, и то, что сохраняется, — одна строка", () => {
  assert.equal(
    BLANK_CONSENT_TEXT,
    "Даю согласие на обработку персональных данных и ознакомлен с политикой конфиденциальности",
  );
  const links = BLANK_CONSENT_PARTS.filter((part) => "href" in part).map((part) => ("href" in part ? part.href : ""));
  assert.deepEqual(links, ["/consent", "/privacy"], "ссылки на действующие документы, как у регистрации");
});

test("почта: канонический вид, мусор и слишком длинные — null", () => {
  assert.equal(normalizeBlankEmail("  Ivan.Petrov@Example.COM "), "ivan.petrov@example.com");
  for (const bad of ["", "ivan", "ivan@", "@example.com", "ivan@example", "iv an@example.com", 42, null]) {
    assert.equal(normalizeBlankEmail(bad), null, String(bad));
  }
  assert.equal(normalizeBlankEmail(`${"a".repeat(195)}@example.com`), null);
});

test("адреса: файл без токена, страница с окном, журнал в кабинете, вход и регистрация", () => {
  const code = { kind: "code", code: "hygiene" } as const;
  const paper = { kind: "paper", paperId: "ot_intro" } as const;
  assert.equal(blankFilePath(code, "pdf"), "/api/journal-samples/hygiene/pdf");
  assert.equal(blankFilePath(code, "docx"), "/api/journal-samples/hygiene/docx");
  assert.equal(blankFilePath(paper, "pdf"), "/api/journal-samples/paper/ot_intro/pdf");
  assert.equal(blankPagePath(code, "docx"), "/journals-info/hygiene?download=docx");
  assert.equal(blankPagePath(paper, "pdf"), "/blanki?download=pdf&paper=ot_intro");
  assert.equal(blankCabinetPath(code), "/journals/hygiene");
  assert.equal(blankCabinetPath(paper), "/settings/journals/paper/ot_intro");

  const register = new URL(blankRegisterHref({ email: "a@example.com", target: code }), "https://wesetup.ru");
  assert.equal(register.pathname, "/register");
  assert.equal(register.searchParams.get("email"), "a@example.com");
  assert.equal(register.searchParams.get("source"), "blank");
  assert.equal(register.searchParams.get("journal"), "hygiene");
  assert.equal(register.searchParams.get("next"), "/journals/hygiene");
  assert.equal(blankRegisterHref({}), "/register?source=blank");

  const login = new URL(blankLoginHref({ email: "a@example.com", target: code }), "https://wesetup.ru");
  assert.equal(login.pathname, "/login");
  assert.equal(login.searchParams.get("email"), "a@example.com");
  assert.equal(login.searchParams.get("next"), "/journals/hygiene");
  assert.equal(blankLoginHref({}), "/login");
});

test("ключ цели и отметка источника регистрации", () => {
  assert.equal(blankTargetKey({ kind: "code", code: "health_check" }), "code:health_check");
  assert.deepEqual(parseBlankTargetKey("paper:fire_safety"), { kind: "paper", paperId: "fire_safety" });
  assert.equal(parseBlankTargetKey("code:../etc"), null);
  assert.equal(blankSignupPlace("cleaning_ventilation_checklist"), "blank:cleaning_ventilation_checklist");
  assert.ok(blankSignupPlace("cleaning_ventilation_checklist").length <= 40, "сервер режет место до 40");
  assert.equal(blankSignupPlace("paper:ot_intro"), "blank:paper:ot_intro");
  assert.equal(blankSignupPlace("<script>"), "blank");
  assert.equal(blankSignupPlace(null), "blank");
});

test("запомненная почта: только валидная пара «почта + редакция»", () => {
  assert.deepEqual(readRememberedBlankEmail(JSON.stringify({ email: "A@Example.com", consentVersion: "2026-09-22" })), {
    email: "a@example.com",
    consentVersion: "2026-09-22",
  });
  assert.equal(readRememberedBlankEmail(JSON.stringify({ email: "a@example.com" })), null);
  assert.equal(readRememberedBlankEmail("{broken"), null);
  assert.equal(readRememberedBlankEmail(null), null);
});

test("запрос на скачивание: почта, цель, формат и согласие", () => {
  const ok = parseBlankDownloadRequest(
    { email: " Zav@Example.com ", code: "hygiene", format: "docx", consent: true },
    "2026-09-22",
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.email, "zav@example.com");
    assert.deepEqual(ok.value.info.target, { kind: "code", code: "hygiene" });
    assert.equal(ok.value.info.title, "Гигиенический журнал (сотрудники)", "название из каталога — как в письме");
    assert.deepEqual(ok.value.info.formats, ["pdf", "docx"]);
    assert.equal(ok.value.format, "docx");
  }

  const paper = parseBlankDownloadRequest({ email: "a@example.com", paperId: "ot_intro", format: "pdf", consent: true }, "v");
  assert.equal(paper.ok && paper.value.info.target.kind, "paper");

  const cases: Array<[unknown, number, string]> = [
    [{ email: "a@example.com", code: "hygiene", format: "pdf" }, 400, "без галки"],
    [{ email: "a@example.com", code: "hygiene", format: "pdf", consent: "true" }, 400, "согласие только true"],
    [{ email: "нет", code: "hygiene", format: "pdf", consent: true }, 400, "плохая почта"],
    [{ email: "a@example.com", format: "pdf", consent: true }, 400, "без шаблона"],
    [{ email: "a@example.com", code: "hygiene", paperId: "ot_intro", format: "pdf", consent: true }, 400, "две цели сразу"],
    [{ email: "a@example.com", code: "no_such_journal", format: "pdf", consent: true }, 404, "чужой код"],
    [{ email: "a@example.com", code: "med_books", format: "docx", consent: true }, 400, "Word только у шести журналов"],
    [{ email: "a@example.com", paperId: "ot_intro", format: "docx", consent: true }, 400, "бумажный бланк — только PDF"],
    [{ email: "a@example.com", code: "hygiene", format: "xlsx", consent: true }, 400, "неизвестный формат"],
    [null, 400, "пустое тело"],
  ];
  for (const [body, status, label] of cases) {
    const result = parseBlankDownloadRequest(body, "2026-09-22");
    assert.equal(result.ok, false, label);
    if (!result.ok) assert.equal(result.status, status, label);
  }
});

test("запомненное согласие со старой редакцией документов — 409, спросить галку заново", () => {
  const stale = parseBlankDownloadRequest(
    { email: "a@example.com", code: "hygiene", format: "pdf", consent: true, remembered: true, consentVersion: "2026-01-01" },
    "2026-09-22",
  );
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.status, 409);
    assert.equal(stale.needConsent, true);
  }
  const fresh = parseBlankDownloadRequest(
    { email: "a@example.com", code: "hygiene", format: "pdf", consent: true, remembered: true, consentVersion: "2026-09-22" },
    "2026-09-22",
  );
  assert.equal(fresh.ok, true);
});

test("лимиты: 30 в час с адреса, 50 в сутки на почту, писем — 10 в сутки", () => {
  assert.deepEqual(BLANK_LIMITS, { perIpPerHour: 30, perEmailPerDay: 50, emailsPerDay: 10 });

  const limiter = createBlankDownloadLimiter();
  for (let i = 0; i < 30; i += 1) {
    assert.equal(limiter.consume("10.0.0.1", `user${i}@example.com`), null, `скачивание ${i + 1}`);
  }
  const blocked = limiter.consume("10.0.0.1", "other@example.com");
  assert.equal(blocked?.scope, "ip");
  assert.ok((blocked?.retryAfterSec ?? 0) > 3500 && (blocked?.retryAfterSec ?? 0) <= 3600);
  // Другой адрес — свой счётчик.
  assert.equal(limiter.consume("10.0.0.2", "other@example.com"), null);

  const perEmail = createBlankDownloadLimiter();
  for (let i = 0; i < 50; i += 1) {
    assert.equal(perEmail.consume(`10.1.0.${i}`, "same@example.com"), null, `почта, скачивание ${i + 1}`);
  }
  const emailBlocked = perEmail.consume("10.2.0.1", "same@example.com");
  assert.equal(emailBlocked?.scope, "email");
  assert.ok((emailBlocked?.retryAfterSec ?? 0) > 86000);
  // Отказ по почте не съедает лимит адреса: с него же можно скачать на другую почту 30 раз.
  for (let i = 0; i < 30; i += 1) {
    assert.equal(perEmail.consume("10.2.0.1", `fresh${i}@example.com`), null, `адрес после отказа, ${i + 1}`);
  }

  const letters = createBlankDownloadLimiter();
  const sent = Array.from({ length: 12 }, () => letters.consumeEmail("victim@example.com"));
  assert.deepEqual(sent.filter(Boolean).length, 10, "одиннадцатое и дальше письмо в сутки не уходит");
  assert.equal(letters.consumeEmail("another@example.com"), true);
});
