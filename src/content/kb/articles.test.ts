import assert from "node:assert/strict";
import test from "node:test";

import { KB_ARTICLES, kbHeadings, kbNeighbours } from "@/content/kb/articles";
import { KB_SHOTS } from "@/content/kb/shots";
import { kbAskInstructions, KB_ASK_INSTRUCTIONS_LIMIT } from "@/lib/kb/ask-instructions";
import { kbArticleText, kbCorpus } from "@/lib/kb/corpus";

test("адреса статей уникальны и латиницей", () => {
  const slugs = KB_ARTICLES.map((article) => article.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const slug of slugs) assert.match(slug, /^[a-z0-9-]+$/);
});

test("снимки из статей существуют, метки в пределах кадра", () => {
  for (const article of KB_ARTICLES) {
    for (const block of article.blocks) {
      const ids = block.t === "shot" ? [block.id] : block.t === "phones" ? block.ids : [];
      for (const id of ids) assert.ok(KB_SHOTS[id], `${article.slug}: нет снимка ${id}`);
    }
  }
  for (const shot of Object.values(KB_SHOTS)) {
    for (const mark of shot.marks) {
      assert.ok(mark.x >= 0 && mark.y >= 0 && mark.x + mark.w <= 100.5 && mark.y + mark.h <= 100.5, `${shot.id} #${mark.n}`);
    }
  }
});

test("ссылки на статьи базы знаний ведут на существующие статьи", () => {
  const slugs = new Set(KB_ARTICLES.map((article) => article.slug));
  for (const article of KB_ARTICLES) {
    for (const [, slug] of kbArticleText(article).matchAll(/\/baza-znaniy\/([a-z0-9-]+)/g)) {
      assert.ok(slugs.has(slug), `${article.slug} → ${slug}`);
    }
    const raw = JSON.stringify(article.blocks);
    for (const [, slug] of raw.matchAll(/\/baza-znaniy\/([a-z0-9-]+)/g)) assert.ok(slugs.has(slug), `${article.slug} → ${slug}`);
  }
});

test("оглавление и соседние статьи", () => {
  const first = KB_ARTICLES[0];
  assert.equal(kbNeighbours(first.slug).prev, null);
  assert.equal(kbNeighbours(first.slug).next?.slug, KB_ARTICLES[1].slug);
  assert.ok(kbHeadings(first).length > 0);
});

test("корпус для ИИ без разметки и с подписями снимков", () => {
  const corpus = kbCorpus();
  assert.ok(!corpus.includes("**"));
  assert.ok(corpus.includes("Начальная настройка"));
  assert.ok(corpus.length < 60_000, `корпус ${corpus.length} символов`);
});

test("инструкции ИИ помещаются в лимит шлюза и подбирают статью по вопросу", () => {
  for (const question of ["Что делать, если пришла проверка?", "Сколько стоит тариф Премиум", "x"]) {
    const text = kbAskInstructions(question);
    assert.ok(text.length <= KB_ASK_INSTRUCTIONS_LIMIT, `${question}: ${text.length}`);
  }
  assert.ok(kbAskInstructions("Сколько стоит тариф Премиум и как оплатить").includes("/baza-znaniy/tarify-i-oplata)"));
  assert.ok(kbAskInstructions("проверяющий QR журналы просмотр").includes("# QR для проверяющего"));
});

test("база знаний — для любой сферы, объекты описаны (владелец, 2026-11-23)", () => {
  const text = (slug: string) => {
    const article = KB_ARTICLES.find((item) => item.slug === slug);
    assert.ok(article, slug);
    return kbArticleText(article);
  };
  // Поварские примеры не выдаём за общее правило: у человека может быть клиника
  // или фитнес. Проверяем свой текст статей; подписи снимков — экраны демо-столовой.
  for (const article of KB_ARTICLES) {
    const authored = JSON.stringify([article.title, article.lead, article.blocks.filter((block) => block.t !== "shot" && block.t !== "phones")]);
    assert.doesNotMatch(authored, /повар|«К Вам пришла проверка»/i, article.slug);
  }
  const objects = text("torgovye-tochki");
  for (const sphere of ["Общественное питание и производство пищевой продукции", "Медицинские услуги", "Услуги потребителям", "Спорт и рекреация"]) {
    assert.ok(objects.includes(sphere), `«Объекты»: ${sphere}`);
  }
  assert.match(objects, /Добавить объект/);
  assert.match(objects, /Контролировать климат/);
  assert.match(objects, /Программа производственного контроля/);
  const registration = text("registraciya");
  assert.doesNotMatch(registration, /Сфера и тип/);
  assert.match(registration, /Объекты и их сфера/);
  assert.match(text("nachalnaya-nastroyka"), /сферу/);
});
