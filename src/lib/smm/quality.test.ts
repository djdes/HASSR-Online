import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WESETUP_BRAND as P } from "./brand-profile";
import { analyzePlan, analyzePost, applyAllFixes, applyFix, freeSlots, parseReview, plainText, similarity } from "./quality";

const NOW = new Date("2026-11-25T09:00:00Z");

const GOOD = [
  "🧾 **Как пройти проверку Роспотребнадзора за 15 минут?**",
  "",
  "Инспектор первым делом смотрит журналы. В WeSetup они заполняются каждый день с телефона, а распечатать всё можно в один клик.",
  "",
  "• напоминания сотрудникам",
  "• 35 журналов в одном месте",
  "• уже 400 заведений ведут журналы у нас",
  "",
  "Попробуйте бесплатно 14 дней — кнопка под постом.",
  "📞 +7 (495) 109-65-43 · wesetup.ru",
  "",
  "#WeSetup #ХАССП #проверка",
].join("\n");

function item(report: ReturnType<typeof analyzePost>, id: string) {
  return report.items.find((i) => i.id === id);
}

describe("analyzePost", () => {
  it("хороший пост — готов к публикации", () => {
    const report = analyzePost(
      { text: GOOD, images: [{ width: 1280, height: 960, branded: true }], buttonText: "Попробовать", buttonUrl: "https://wesetup.ru/register", campaign: "test", rubric: "feature", scheduledAt: "2026-11-26T07:00:00Z" },
      P,
      { now: NOW },
    );
    assert.equal(report.verdict, "ready", JSON.stringify(report.items.filter((i) => i.status !== "ok"), null, 1));
    assert.ok(report.score >= 80);
    assert.ok(report.salesIndex >= 70);
    assert.ok(report.spamIndex <= 10);
  });

  it("спам: капс, !!!, спам-слова", () => {
    const report = analyzePost({ text: "СРОЧНО!!! ТОЛЬКО СЕГОДНЯ скидка, успей купить!!! Жми!" }, P, { now: NOW });
    assert.equal(item(report, "caps")?.status, "fail");
    assert.equal(item(report, "exclamations")?.status, "fail");
    assert.equal(item(report, "spam-words")?.status, "fail");
    assert.ok(report.spamIndex >= 60);
    assert.equal(report.verdict, "block");
  });

  it("стоп-слово бренда блокирует", () => {
    const report = analyzePost({ text: `${GOOD}\nМы разрабатываем новый журнал.` }, P, { now: NOW });
    const stop = report.items.find((i) => i.id.startsWith("stop:"));
    assert.equal(stop?.status, "fail");
    assert.equal(stop?.blocking, true);
    assert.equal(report.verdict, "block");
  });

  it("чужой телефон блокирует", () => {
    const report = analyzePost({ text: `${GOOD}\nЗвоните +7 (900) 123-45-67` }, P, { now: NOW });
    assert.equal(item(report, "phone")?.status, "fail");
    assert.equal(report.verdict, "block");
  });

  it("без эталонных телефонов номер не блокирует", () => {
    const report = analyzePost({ text: `${GOOD}
Звоните +7 (900) 123-45-67` }, { ...P, phones: [] }, { now: NOW });
    assert.equal(item(report, "phone")?.status, "ok");
  });

  it("неправильное написание бренда и обращение на «ты»", () => {
    const report = analyzePost({ text: "**Wesetup для тебя**\nТвой журнал всегда под рукой." }, P, { now: NOW });
    assert.equal(report.items.find((i) => i.id === "spelling:Wesetup")?.status, "fail");
    assert.equal(item(report, "address")?.status, "fail");
  });

  it("прошедшая дата акции и заглушки шаблона", () => {
    const report = analyzePost({ text: "**Акция** до 20 ноября — скидка [выгода]", scheduledAt: "2026-11-26T07:00:00Z" }, P, { now: NOW });
    assert.ok(report.items.some((i) => i.id.startsWith("date:") && i.status === "fail"));
    assert.equal(item(report, "placeholders")?.status, "fail");
  });

  it("дубль прошлого поста", () => {
    const report = analyzePost({ text: GOOD }, P, { now: NOW, recent: [{ text: GOOD.replace("15 минут", "20 минут"), at: "2026-11-20T07:00:00Z" }] });
    assert.equal(item(report, "duplicate")?.status, "fail");
  });

  it("тихие часы и частота", () => {
    const report = analyzePost({ text: GOOD, scheduledAt: "2026-11-26T21:30:00Z" }, P, {
      now: NOW,
      recent: [{ text: "другой пост про холодильники и температуру", at: "2026-11-26T20:30:00Z" }],
    });
    assert.equal(item(report, "window")?.status, "warn");
    assert.equal(item(report, "frequency")?.status, "warn");
  });

  it("подпись Telegram длиннее 1024 при фото", () => {
    const report = analyzePost({ text: "а".repeat(1100), images: [{}], platforms: ["telegram"] }, P, { now: NOW });
    assert.equal(item(report, "tg-caption")?.status, "warn");
  });
});

describe("автоисправления", () => {
  it("починить всё поднимает балл", () => {
    const bad = { text: "Wesetup СРОЧНО!!! 🔥🔥🔥 мы разрабатываем журналы для кафе и столовых, чтобы проверка шла спокойно", images: [{}] };
    const before = analyzePost(bad, P, { now: NOW });
    const fixed = applyAllFixes(bad, P);
    const after = analyzePost({ ...bad, text: fixed }, P, { now: NOW });
    assert.ok(after.score > before.score, `${before.score} → ${after.score}\n${fixed}`);
    assert.ok(!/разрабатыва/i.test(fixed));
    assert.ok(fixed.includes("WeSetup"));
    assert.ok(fixed.includes("+7 (495) 109-65-43"));
    assert.ok(/#WeSetup/.test(fixed));
    assert.ok(!/!!/.test(fixed));
  });

  it("жирный заголовок с эмодзи", () => {
    assert.equal(applyFix({ text: "🔥 Заголовок\nтекст" }, "bold-headline", P), "🔥 **Заголовок**\nтекст");
  });

  it("хэштеги не дублируются и встают последней строкой", () => {
    const out = applyFix({ text: "Текст\n\n#ХАССП", rubric: "journal" }, "add-hashtags", P);
    assert.match(out, /\n\n#ХАССП #журналы/);
    assert.equal(out.match(/#ХАССП/g)?.length, 1);
  });
});

describe("план", () => {
  it("лимит в день, продающий перекос, свободные слоты", () => {
    const at = (d: string, h: number) => new Date(`2026-11-${d}T${String(h - 3).padStart(2, "0")}:00:00Z`);
    const posts = [
      { id: "1", at: at("26", 10), text: "пост один про журналы и холодильники", rubric: "promo" },
      { id: "2", at: at("26", 14), text: "пост два про акцию и скидку сегодня", rubric: "promo" },
      { id: "3", at: at("26", 19), text: "пост три про новую функцию сервиса", rubric: "feature" },
      { id: "4", at: at("27", 10), text: "пост четыре полезный про нормы СанПиН", rubric: "norm" },
    ];
    const plan = analyzePlan(posts, P, { now: NOW });
    assert.ok(plan.issues.some((i) => i.feature === "B21"));
    assert.ok(plan.issues.some((i) => i.feature === "B22"));
    assert.ok(plan.freeSlots.length > 0);
    assert.ok(plan.freeSlots.every((s) => s.getTime() > NOW.getTime()));
    const slots = freeSlots(posts, P, { now: NOW, slots: ["10:00"] });
    assert.ok(!slots.some((s) => s.getTime() === at("26", 10).getTime()));
  });
});

describe("утилиты", () => {
  it("plainText снимает разметку", () => {
    assert.equal(plainText("**Жирно** и [ссылка](https://x.ru) и `код`"), "Жирно и ссылка и код");
  });
  it("similarity", () => {
    assert.ok(similarity("один два три четыре пять шесть", "один два три четыре пять семь") > 0.5);
    assert.equal(similarity("а б", "в г"), 0);
  });
  it("parseReview", () => {
    const r = parseReview('```json\n{"tone": 80, "offer": 120, "notes": ["ок"], "text": "Новый текст"}\n```');
    assert.deepEqual(r, { tone: 80, offer: 100, notes: ["ок"], text: "Новый текст" });
  });
});
