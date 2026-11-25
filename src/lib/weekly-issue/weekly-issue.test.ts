import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWeeklyInput,
  buildWeeklyInstructions,
  emailBodyFromPost,
  headlineOf,
  parseWeeklyPost,
  selectCommitSubjects,
  type WeeklyFacts,
} from "@/lib/weekly-issue/facts";
import { nthWeekday, orthodoxEaster, upcomingOccasions } from "@/lib/weekly-issue/occasions";
import { autoBuildWeekKey, issueIsOut, upcomingWednesday, weeklyPublishAt } from "@/lib/weekly-issue/schedule";

/** Момент по Москве: "2026-11-30 08:00" → Date. */
const msk = (value: string) => new Date(`${value.replace(" ", "T")}:00+03:00`);

test("выход — среда 09:00 МСК", () => {
  assert.equal(weeklyPublishAt("2026-12-02").toISOString(), "2026-12-02T06:00:00.000Z");
});

test("автосборка: с понедельника 08:00 до среды (за 2 часа до выхода) — среда этой недели", () => {
  assert.equal(autoBuildWeekKey(msk("2026-11-30 07:59")), null, "понедельник до 08:00 — ещё рано");
  assert.equal(autoBuildWeekKey(msk("2026-11-30 08:00")), "2026-12-02");
  assert.equal(autoBuildWeekKey(msk("2026-12-01 23:30")), "2026-12-02");
  assert.equal(autoBuildWeekKey(msk("2026-12-02 06:59")), "2026-12-02");
  assert.equal(autoBuildWeekKey(msk("2026-12-02 07:01")), null, "меньше двух часов до выхода — не успеть");
  assert.equal(autoBuildWeekKey(msk("2026-12-03 10:00")), null, "четверг — следующая неделя ещё не началась");
  assert.equal(autoBuildWeekKey(msk("2026-11-29 12:00")), null, "воскресенье");
  // Полночь по Москве в понедельник — ещё воскресенье по UTC, но окно считается по Москве.
  assert.equal(autoBuildWeekKey(new Date("2026-11-30T05:00:00Z")), "2026-12-02");
});

test("идемпотентность: каждую минуту окна крон получает одну и ту же неделю — один выпуск в неделю", () => {
  const keys = new Set<string>();
  const start = msk("2026-11-23 00:00").getTime();
  for (let t = start; t < start + 28 * 86_400_000; t += 15 * 60_000) {
    const key = autoBuildWeekKey(new Date(t));
    if (key) keys.add(key);
  }
  assert.deepEqual([...keys].sort(), ["2026-11-25", "2026-12-02", "2026-12-09", "2026-12-16"]);
  for (const key of keys) assert.equal(new Date(`${key}T12:00:00Z`).getUTCDay(), 3, `${key} — среда`);
});

test("кнопка «Собрать выпуск на среду» — ближайшая среда, до которой ещё есть время", () => {
  assert.equal(upcomingWednesday(msk("2026-11-25 15:00")), "2026-12-02", "среда после выхода — следующая");
  assert.equal(upcomingWednesday(msk("2026-11-25 06:00")), "2026-11-25", "среда утром, до выхода 3 часа — сегодня");
  assert.equal(upcomingWednesday(msk("2026-11-25 07:30")), "2026-12-02", "меньше двух часов — уже следующая");
  assert.equal(upcomingWednesday(msk("2026-11-30 10:00")), "2026-12-02");
  assert.equal(upcomingWednesday(msk("2026-11-29 23:00")), "2026-12-02");
});

test("вышедший выпуск не пересобирается и не отменяется", () => {
  assert.equal(issueIsOut({ status: "scheduled", emailStatus: "draft" }, ["scheduled", "scheduled"]), false);
  assert.equal(issueIsOut({ status: "review", emailStatus: "draft" }, ["review"]), false);
  assert.equal(issueIsOut({ status: "scheduled", emailStatus: "draft" }, ["sent", "scheduled"]), true);
  assert.equal(issueIsOut({ status: "scheduled", emailStatus: "draft" }, ["sending"]), true);
  assert.equal(issueIsOut({ status: "scheduled", emailStatus: "sent" }, []), true);
  assert.equal(issueIsOut({ status: "published", emailStatus: "skipped" }, []), true);
});

test("коммиты → изменения для клиентов: без техники, внутренних разделов, номеров PR и повторов", () => {
  const picked = selectCommitSubjects([
    "Интерфейс без «сочинений»: короткие подписи, пояснения — в момент действия (#343)\n\n* подробности",
    "СММ: панель качества — без повторных шкал",
    "CRM: звонки Телфина в карточке",
    "Рассылки: окно отправки",
    "Merge branch 'master' into feat/x",
    "chore: bump deps",
    "fix: журнал бракеража сохраняет фото с телефона",
    "Тесты на расписание автопостов",
    "Протестировали вход по телефону — теперь код приходит быстрее",
    "Интерфейс без «сочинений»: короткие подписи, пояснения — в момент действия (#344)",
    "ok",
  ]);
  assert.deepEqual(picked, [
    "Интерфейс без «сочинений»: короткие подписи, пояснения — в момент действия",
    "журнал бракеража сохраняет фото с телефона",
    "Протестировали вход по телефону — теперь код приходит быстрее",
  ]);
});

test("праздники и поводы: Пасха, n-й день недели, ближайшие к 2 декабря 2026", () => {
  assert.equal(orthodoxEaster(2026), "2026-04-12");
  assert.equal(orthodoxEaster(2027), "2027-05-02");
  assert.equal(nthWeekday(2026, 10, 0, 3), "2026-10-18", "День работников пищевой промышленности — 3-е воскресенье октября");
  const list = upcomingOccasions("2026-12-02", 31);
  const keys = list.map((o) => o.key);
  assert.ok(keys.includes("corporate-season"), "сезон корпоративов уже идёт");
  assert.equal(list.find((o) => o.key === "corporate-season")?.daysAway, 0);
  assert.ok(keys.includes("new-year"));
  assert.equal(list.find((o) => o.key === "new-year")?.dateKey, "2027-01-01");
  assert.ok(!keys.includes("chef-day"), "прошедший День повара не берём");
  for (const o of list) assert.ok(o.hint.length > 20, o.key);
});

const FACTS: WeeklyFacts = {
  weekKey: "2026-12-02",
  periodFrom: "2026-11-23",
  periodTo: "2026-11-30",
  changes: ["Журнал бракеража сохраняет фото с телефона"],
  changesSource: "github",
  changelog: [],
  articles: [{ title: "Как подготовиться к проверке", url: "https://wesetup.ru/blog/x" }],
  promotions: [],
  upcomingPosts: [{ date: "2026-12-05", title: "Журнал температуры холодильников" }],
  occasions: upcomingOccasions("2026-12-02", 31),
};

test("факты для ИИ: все разделы, пустые — с запретом выдумывать", () => {
  const input = buildWeeklyInput(FACTS);
  assert.match(input, /2 декабря/);
  assert.match(input, /Журнал бракеража сохраняет фото/);
  assert.match(input, /Как подготовиться к проверке/);
  assert.match(input, /акций нет — скидки не упоминай/);
  assert.match(input, /Сезон новогодних корпоративов/);
  assert.match(input, /5 декабря: Журнал температуры холодильников/);
  const offline = buildWeeklyInput({ ...FACTS, changes: [], changesSource: "unavailable" });
  assert.match(offline, /про обновления не пиши/);
  const instructions = buildWeeklyInstructions();
  assert.match(instructions, /"subject"/);
  assert.match(instructions, /ничего не выдумывай/);
  assert.match(instructions, /разрабатываем/);
});

test("ответ ИИ: JSON с темой, текстом и запросом картинки; ссылки и короткие тексты отклоняются", () => {
  const text = "🎄 **Готовимся к сезону корпоративов**\n\nДекабрь — горячая пора для кухни. Больше заготовок, банкетов и смен: самое время навести порядок в журналах.\n\n• бракераж с телефона\n• температура холодильников под контролем\n\nЗагляните на сайт — расскажем, как это работает.\n\n#WeSetup #ХАССП #общепит";
  const ok = parseWeeklyPost("```json\n" + JSON.stringify({ subject: "«Сезон корпоративов без бумажных журналов»", text, imagePrompt: "banquet kitchen" }) + "\n```");
  assert.ok(ok);
  assert.equal(ok.subject, "Сезон корпоративов без бумажных журналов");
  assert.equal(ok.imagePrompt, "banquet kitchen");
  assert.equal(parseWeeklyPost(JSON.stringify({ text: `${text} https://wesetup.ru` })), null);
  assert.equal(parseWeeklyPost(JSON.stringify({ text: "коротко" })), null);
  assert.equal(parseWeeklyPost("не JSON"), null);
  const noSubject = parseWeeklyPost(JSON.stringify({ text }));
  assert.equal(noSubject?.subject, "Готовимся к сезону корпоративов");
  assert.equal(headlineOf(text), "Готовимся к сезону корпоративов");
});

test("письмо из поста: без заголовка (он в теме) и без строки хэштегов", () => {
  const body = emailBodyFromPost("🎄 **Заголовок**\n\nПервый абзац с **важным**.\n\n• пункт\n\n📞 +7 (495) 109-65-43 · wesetup.ru\n#WeSetup #ХАССП");
  assert.equal(body, "Первый абзац с **важным**.\n\n• пункт\n\n📞 +7 (495) 109-65-43 · wesetup.ru");
});
