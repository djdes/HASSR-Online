import type { BrandProfile } from "./quality";

/**
 * Фирменный стиль WeSetup для контроля постов (B03). Источник — брендбук
 * «сетап 1.0» (05.11.2026): индиго #5566f6, «вы», без «разрабатываем» в
 * текстах о готовых возможностях, подпись с телефонами отдела продаж.
 */
export const WESETUP_BRAND: BrandProfile = {
  name: "WeSetup",
  nameVariants: ["Сетап", "сетап", "wesetup.ru"],
  replacements: [
    { wrong: "Wesetup", right: "WeSetup" },
    { wrong: "WESETUP", right: "WeSetup" },
    { wrong: "We Setup", right: "WeSetup" },
    { wrong: "ВиСетап", right: "WeSetup" },
    { wrong: "Висетап", right: "WeSetup" },
    { wrong: "ХАСП", right: "ХАССП" },
    { wrong: "Хассп", right: "ХАССП" },
    { wrong: "Санпин", right: "СанПиН" },
    { wrong: "САНПИН", right: "СанПиН" },
    { wrong: "роспотребнадзор", right: "Роспотребнадзор" },
  ],
  siteHosts: ["wesetup.ru"],
  phones: ["+7 (495) 109-65-43", "+7 (925) 305-80-77"],
  signature: "📞 +7 (495) 109-65-43 · wesetup.ru",
  hashtags: ["#WeSetup", "#ХАССП", "#СанПиН", "#общепит"],
  hashtagsRange: { min: 2, max: 4 },
  stopWords: [
    { word: "разрабатыва", reason: "Журналы и ХАССП уже готовы — пишем «помогаем внедрить», а не «разрабатываем»." },
    { word: "в разработке", reason: "Не обещаем будущего — говорим о том, что работает сейчас." },
    { word: "дешёвый", reason: "Бренд не продаёт дешевизну — говорим о выгоде и экономии времени." },
    { word: "дешевый", reason: "Бренд не продаёт дешевизну — говорим о выгоде и экономии времени." },
    { word: "гарантируем отсутствие штрафов", reason: "Не гарантируем исход проверки — говорим «готовы к проверке»." },
    { word: "100% защит", reason: "Не обещаем абсолютной защиты от штрафов." },
  ],
  address: "вы",
  emojiRange: { min: 1, max: 5 },
  length: { min: 250, max: 900 },
  boldHeadline: true,
  rubrics: [
    { key: "journal", label: "Журнал недели", kind: "useful", hashtag: "#журналы", length: { min: 300, max: 900 } },
    { key: "norm", label: "Нормы и проверки", kind: "useful", hashtag: "#проверка", length: { min: 300, max: 900 } },
    { key: "feature", label: "Возможность сервиса", kind: "selling", hashtag: "#WeSetup", require: { button: true } },
    { key: "case", label: "Кейс клиента", kind: "selling", hashtag: "#кейс", require: { button: true } },
    { key: "promo", label: "Акция", kind: "selling", hashtag: "#акция", length: { min: 150, max: 600 }, require: { button: true, cta: true } },
    { key: "news", label: "Новости", kind: "news", hashtag: "#новости", require: { image: false } },
    { key: "term", label: "Словарь", kind: "useful", hashtag: "#словарь" },
  ],
  postingWindow: { from: "08:30", to: "21:00" },
  maxPostsPerDay: 2,
  minGapMinutes: 180,
  maxSellingShare: 0.35,
  minScoreToPublish: 60,
  colors: { primary: "#5566f6", accent: "#7c8bff", dark: "#0b1024", light: "#f4f6ff" },
  toneOfVoice:
    "эксперт-коллега для заведующей производством и технолога: спокойно, по делу, с практической пользой, без рекламной воды и запугивания штрафами; короткие абзацы; конкретные нормы и шаги.",
};
