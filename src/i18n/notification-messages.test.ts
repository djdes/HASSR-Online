import assert from "node:assert/strict";
import test from "node:test";
import { asNotificationMessageParams, notificationPresenter } from "./notification-messages";
import { IDEA_STATUSES, IDEA_STATUS_LABEL, describeIdeaStatusChange } from "@/lib/ideas/rules";

test("notification history is presented per reader without mutating persisted or customer text", async () => {
  const stored = {
    id: "notice-1", kind: "staff.added.journal", title: "Список фамилий, которые нужно внести в",
    linkHref: "/journals/hygiene", linkLabel: "гигиенический журнал",
    messageKey: null, messageParams: null, linkLabelKey: null,
    items: [{ id: "employee-1", label: "Иван O‘tkir", hint: "Моя должность", href: "/staff/employee-1" }],
  };
  const original = structuredClone(stored);
  const presenters = await Promise.all([notificationPresenter("ru"), notificationPresenter("en"), notificationPresenter("uz")]);
  const rows = presenters.map((presenter) => presenter.row(stored));
  assert.equal(new Set(rows.map((row) => row.title)).size, 3);
  for (const row of rows) {
    assert.deepEqual(row.items, stored.items);
    assert.equal(row.id, stored.id);
    assert.equal(row.linkHref, stored.linkHref);
  }
  assert.deepEqual(stored, original);
  const custom = { ...stored, title: "Наш собственный текст", linkLabel: "Наша ссылка" };
  assert.deepEqual(presenters[1].row(custom), custom);
});

test("explicit notification keys localize and unknown keys preserve the legacy fallback", async () => {
  const presenter = await notificationPresenter("en");
  const row = { kind: "position.missing.trainingPlan", title: "Fallback", messageKey: "trainingPlan", linkLabel: "Original", linkLabelKey: "openTrainingPlan", items: [] };
  assert.notEqual(presenter.row(row).title, row.title);
  assert.notEqual(presenter.row(row).linkLabel, row.linkLabel);
  for (const key of ["__proto__", "constructor", "user-entered text"]) {
    assert.equal(presenter.row({ ...row, messageKey: key }).title, row.title);
  }
  assert.deepEqual(asNotificationMessageParams({ name: "Исходное имя", count: 2 }), { name: "Исходное имя", count: 2 });
  assert.equal(asNotificationMessageParams({ count: NaN }), undefined);
  assert.equal(asNotificationMessageParams({ nested: {} }), undefined);
});

test("push messages retain employee names and render plural counts in each recipient locale", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const presenter = await notificationPresenter(locale);
    assert.ok(presenter.pushBody([]));
    assert.equal(presenter.pushBody([{ label: "O‘tkir Иван" }]), "O‘tkir Иван");
    const text = presenter.pushBody([{ label: "O‘tkir Иван" }, { label: "Second" }, { label: "Third" }]);
    assert.ok(text.includes("O‘tkir Иван"));
    assert.ok(text.includes("2"));
    assert.ok(!text.includes("{count"));
  }
});

test("parameterized descriptors preserve names and authored text in bell and push for every locale", async () => {
  const name = "O‘tkir {status} — Иван";
  const complaints = "Мой текст <b>без изменений</b>";
  for (const locale of ["ru", "en", "uz"] as const) {
    const presenter = await notificationPresenter(locale);
    for (const [labelKey, labelParams] of [
      ["pinRequestItem", { name, kind: "issue" }], ["pinRequestItem", { name, kind: "change" }],
      ["hygieneSigned", { name }], ["hygieneComplaints", { name, complaints }],
    ] as const) {
      const item = { id: "employee", label: "Fallback", labelKey, labelParams, href: "/unchanged" };
      const row = { kind: "test", title: "Original", items: [item] };
      const result = presenter.row(row);
      assert.ok(result.items[0].label.includes(name));
      if (labelKey === "hygieneComplaints") assert.ok(result.items[0].label.includes(complaints));
      assert.equal(result.items[0].href, item.href);
      assert.equal(presenter.pushBody(row.items), result.items[0].label);
      assert.equal(item.label, "Fallback");
    }
    for (const status of IDEA_STATUSES) {
      const title = "Customer idea {status}";
      const result = presenter.row({ kind: "idea.status", title: "Fallback", messageKey: "ideaStatus", messageParams: { title, status }, items: [{ label: title, hint: "Fallback", hintKey: "ideaStatusLabel", hintParams: { status } }] });
      assert.ok(result.title.includes(title));
      assert.notEqual(result.items[0].hint, "Fallback");
      assert.equal(result.items[0].label, title);
    }
  }
});

test("invalid descriptor parameters fall back without executing user strings or ICU", async () => {
  const presenter = await notificationPresenter("en");
  const cases = [
    { key: "pinRequestItem", params: { name: "Person", kind: "admin" } },
    { key: "pinRequestItem", params: { name: 4, kind: "issue" } },
    { key: "hygieneSigned", params: { name: {} } },
    { key: "hygieneComplaints", params: { name: "Person" } },
    { key: "ideaStatus", params: { title: "Idea", status: "__proto__" } },
    { key: "ideaStatusLabel", params: { status: "invented" } },
  ];
  for (const { key, params } of cases) {
    assert.equal(presenter.row({ kind: "custom", title: "Original", messageKey: key, messageParams: params, items: [] }).title, "Original");
    assert.equal(presenter.pushBody([{ label: "Original", labelKey: key, labelParams: params }]), "Original");
  }
});

test("narrow historical adapters translate known wrappers and never rewrite stored history", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const presenter = await notificationPresenter(locale);
    const title = "Очень длинная пользовательская идея ".repeat(4);
    for (const status of IDEA_STATUSES) {
      const row = { kind: "idea.status", title: describeIdeaStatusChange(title, status), linkLabel: "Открыть идеи", items: [{ label: title, hint: IDEA_STATUS_LABEL[status] }] };
      const original = structuredClone(row);
      const result = presenter.row(row);
      assert.ok(result.title.includes(title.slice(0, 57)));
      assert.equal(result.items[0].label, title);
      assert.deepEqual(row, original);
      assert.equal(presenter.row({ ...row, title: "Custom title" }).title, "Custom title");
    }
    for (const [kind, originalTitle, item] of [
      ["feedback.reply", "Получен ответ на ваше обращение", { label: "Ответ: мои слова" }],
      ["mailing", "Моя рассылка", { label: "Произвольный текст" }],
      ["qr_pin_request", "Запросы PIN от сотрудников", { label: "O‘tkir — новый pin", hint: "с QR-страницы" }],
      ["hygiene-admission", "Гигиенический журнал: сотрудники ждут допуска", { label: "O‘tkir — подписал, ждёт допуска", hint: "11:23" }],
    ] as const) {
      const row = { kind, title: originalTitle, linkLabel: kind === "mailing" ? "Открыть" : null, items: [item] };
      const original = structuredClone(row);
      const result = presenter.row(row);
      if (kind === "mailing" || kind === "feedback.reply") assert.equal(result.items[0].label, item.label);
      else assert.ok(result.items[0].label.includes("O‘tkir"));
      if (kind === "mailing") assert.equal(result.title, row.title);
      assert.deepEqual(row, original);
    }
  }
});

test("напоминание о своих 14 днях организации: название как есть, последний день и «Добавить точку» на языке читателя", async () => {
  const name = "Кафе {stage} O‘tkir";
  const row = {
    kind: "billing.org_trial_reminder",
    title: `Бесплатные дни организации «${name}» заканчиваются`,
    messageKey: "orgTrialEnding",
    messageParams: { name, stage: "soon" },
    linkHref: "/settings/subscription?addPoints=1",
    linkLabel: "Добавить точку",
    linkLabelKey: "addPoint",
    items: [{ label: "Последний бесплатный день — 23 ноября", labelKey: "orgTrialLastDay", labelParams: { day: "2026-11-23" } }],
  };
  const titles = new Set<string>();
  for (const locale of ["ru", "en", "uz"] as const) {
    const presenter = await notificationPresenter(locale);
    const result = presenter.row(row);
    assert.ok(result.title.includes(name), result.title);
    assert.ok(result.items[0].label.includes("23"), result.items[0].label);
    assert.ok(!result.items[0].label.includes("{"), result.items[0].label);
    assert.ok(result.linkLabel && !result.linkLabel.includes("{"));
    assert.equal(result.linkHref, row.linkHref);
    titles.add(result.title);
    const tomorrow = presenter.row({ ...row, messageParams: { name, stage: "tomorrow" } });
    assert.notEqual(tomorrow.title, result.title);
    // Не день или без названия — сохранённый русский текст.
    assert.equal(presenter.row({ ...row, messageParams: { stage: "soon" } }).title, row.title);
    const badDay = presenter.row({ ...row, items: [{ ...row.items[0], labelParams: { day: "2026-02-31" } }] });
    assert.equal(badDay.items[0].label, row.items[0].label);
  }
  assert.equal(titles.size, 3);
  const ru = (await notificationPresenter("ru")).row(row);
  assert.equal(ru.items[0].label, "Последний бесплатный день — 23 ноября");
  assert.equal(ru.linkLabel, "Добавить точку");
});

test("напоминание о своих 14 днях: строка «по аккаунту хватает» на языке читателя (серия E, Р9)", async () => {
  const label = "На балансах организаций аккаунта хватает денег — точку можно оплатить с баланса в один шаг.";
  const row = {
    kind: "billing.org_trial_reminder",
    title: "Бесплатные дни организации «Кафе» заканчиваются",
    items: [{ label, labelKey: "orgTrialAccountCovers" }],
  };
  const labels = new Set<string>();
  for (const locale of ["ru", "en", "uz"] as const) {
    const result = (await notificationPresenter(locale)).row(row);
    assert.ok(result.items[0].label.length > 20 && !result.items[0].label.includes("{"), result.items[0].label);
    labels.add(result.items[0].label);
  }
  assert.equal(labels.size, 3);
  assert.equal((await notificationPresenter("ru")).row(row).items[0].label, label);
});
