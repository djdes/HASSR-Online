import { JOURNALS_TOTAL_ELECTRONIC_LABEL, JOURNALS_TOTAL_LABEL } from "@/lib/journal-catalog";

/**
 * Draft campaign spec for Yandex.Direct. Loaded by scripts/yandex-direct-setup.ts
 * which translates it into the API's campaign/adgroup/ad/keyword payload.
 *
 * Every price / limit here is safe-by-default: daily budget set low,
 * campaigns created paused, negative keywords added to block obvious
 * mismatches. Go-live is a manual step after review.
 *
 * Texts are original — no copying from competitor ads. The goal is to
 * ship a working skeleton the user can A/B from.
 */

export type AdCreative = {
  /// ≤35 chars, per Direct rules. Shown as the ad headline.
  title1: string;
  /// ≤30 chars, appears after the headline for mobile/desktop.
  title2: string;
  /// ≤81 chars. Main ad body.
  text: string;
  /// Final URL with UTM already composed.
  href: string;
  /// Shown as the sitelink, optional.
  displayPath?: string;
};

export type AdGroupSpec = {
  name: string;
  /// Top-of-funnel keywords, one per phrase. Direct expects MINUS words
  /// separately — common negatives go on the campaign.
  keywords: string[];
  /// 2–3 creatives per group for A/B.
  ads: AdCreative[];
};

export type CampaignSpec = {
  /// Internal identifier, used for idempotent upsert.
  slug: string;
  name: string;
  /// Daily cap in rubles, enforced by Direct. Keep low for the first week.
  dailyBudgetRub: number;
  /// Negative keywords applied across every ad group in this campaign.
  negativeKeywords: string[];
  adGroups: AdGroupSpec[];
};

const DOMAIN = "https://wesetup.ru";
const UTM = "utm_source=yandex&utm_medium=cpc";

function u(path: string, campaign: string, group?: string): string {
  const utm = `${UTM}&utm_campaign=${campaign}${group ? `&utm_content=${group}` : ""}`;
  return `${DOMAIN}${path}?${utm}`;
}

/// Shared list — applied to every campaign so we don't pay for «скачать
/// бесплатно» traffic that's clearly looking for PDF templates.
const GLOBAL_NEGATIVES = [
  "скачать",
  "бесплатно скачать",
  "бланк",
  "шаблон word",
  "шаблон excel",
  "образец pdf",
  "реферат",
  "курсовая",
  "устарел",
  "2018",
  "2019",
  "2020",
];

export const CAMPAIGNS: CampaignSpec[] = [
  {
    slug: "brand",
    name: "WeSetup · Бренд",
    dailyBudgetRub: 300,
    negativeKeywords: [...GLOBAL_NEGATIVES, "погода", "новости"],
    adGroups: [
      {
        name: "Точные брендовые запросы",
        keywords: [
          "wesetup",
          "wesetup ru",
          "вэсетап",
          "wesetup журналы",
          "wesetup хассп",
          "wesetup санпин",
        ],
        ads: [
          {
            title1: "WeSetup — электронные журналы",
            title2: "СанПиН и ХАССП. Бесплатно",
            text: `${JOURNALS_TOTAL_LABEL}, Telegram-бот, PDF для проверок. Бесплатный тариф до 3 сотрудников.`,
            href: u("/", "brand", "exact"),
            displayPath: "журналы/бесплатно",
          },
          {
            title1: "WeSetup: журналы для кухни",
            title2: "В Telegram и веб",
            text: "Гигиена, температура, бракераж — одним касанием. Попробуйте бесплатно.",
            href: u("/", "brand", "exact2"),
            displayPath: "старт",
          },
        ],
      },
    ],
  },
  {
    slug: "journals-daily",
    name: "WeSetup · Ежедневные журналы",
    dailyBudgetRub: 450,
    negativeKeywords: [
      ...GLOBAL_NEGATIVES,
      "бухгалтерия",
      "кадровый",
      "регистрации браков",
      "отпусков",
    ],
    adGroups: [
      {
        name: "Гигиенический журнал",
        keywords: [
          "гигиенический журнал",
          "гигиенический журнал общепит",
          "гигиенический журнал электронный",
          "журнал осмотра сотрудников",
          "гигиенический журнал санпин",
        ],
        ads: [
          {
            title1: "Гигиенический журнал онлайн",
            title2: "По СанПиН 2.3/2.4.4282-26",
            text: "Автозаполнение, отметка допуска в один тап, PDF для Роспотребнадзора. Бесплатно навсегда.",
            href: u("/journals-info/hygiene", "journals-daily", "hygiene"),
            displayPath: "гигиена/онлайн",
          },
          {
            title1: "Журнал здоровья — электронный",
            title2: "Замена бумажного",
            text: "Отстраняет сотрудников по температуре автоматически. Запускается за 10 минут.",
            href: u("/journals-info/hygiene", "journals-daily", "hygiene2"),
            displayPath: "журнал/здоровья",
          },
        ],
      },
      {
        name: "Журнал температур",
        keywords: [
          "журнал температурного режима",
          "журнал температуры холодильников",
          "журнал холодильного оборудования",
          "контроль температуры холодильника",
          "журнал температуры общепит",
        ],
        ads: [
          {
            title1: "Журнал температур холодильников",
            title2: "Автоматический замер",
            text: "Датчик пишет температуру сам, алерт при выходе за норму уходит в Telegram.",
            href: u(
              "/journals-info/cold_equipment_control",
              "journals-daily",
              "cold"
            ),
            displayPath: "температура/онлайн",
          },
          {
            title1: "Контроль температуры — в WeSetup",
            title2: "Датчики подключаются бесплатно",
            text: "Один раз поставил — журнал ведётся сам. Свои датчики — без абонплаты.",
            href: u(
              "/journals-info/cold_equipment_control",
              "journals-daily",
              "cold2"
            ),
            displayPath: "датчики",
          },
        ],
      },
      {
        name: "Бракеражный журнал",
        keywords: [
          "бракеражный журнал",
          "бракеражный журнал готовой продукции",
          "журнал бракеража",
          "бракераж в общепите",
        ],
        ads: [
          {
            title1: "Бракеражный журнал онлайн",
            title2: "С партией и подписями",
            text: "Партии не склеиваются, органолептика — по чек-листу, PDF за секунду.",
            href: u(
              "/journals-info/finished_product",
              "journals-daily",
              "brakeraz"
            ),
            displayPath: "бракераж",
          },
        ],
      },
      {
        name: "Журнал уборок",
        keywords: [
          "журнал уборки",
          "журнал уборки помещений",
          "график уборок санпин",
          "журнал уборки кухни",
        ],
        ads: [
          {
            title1: "Журнал уборки — электронный",
            title2: "Текущая и генеральная",
            text: "Средство, концентрация, время выдержки — всё автоматически. PDF для инспектора.",
            href: u(
              "/journals-info/cleaning",
              "journals-daily",
              "cleaning"
            ),
            displayPath: "уборка",
          },
        ],
      },
    ],
  },
  {
    slug: "haccp",
    name: "WeSetup · ХАССП",
    dailyBudgetRub: 400,
    negativeKeywords: [
      ...GLOBAL_NEGATIVES,
      "молочного",
      "химический",
      "iso",
      "нефтяной",
    ],
    adGroups: [
      {
        name: "ХАССП автоматизация",
        keywords: [
          "хассп",
          "хассп онлайн",
          "хассп для кафе",
          "хассп для ресторана",
          "хассп автоматизация",
          "план хассп",
          "внедрение хассп",
        ],
        ads: [
          {
            title1: "ХАССП для общепита онлайн",
            title2: "План, аудит, прослеживаемость",
            text: "Разрабатываем, запускаем, ведём. Журналы ХАССП включены в бесплатный тариф.",
            href: u("/journals-info", "haccp", "haccp-main"),
            displayPath: "хассп",
          },
          {
            title1: "ХАССП без бумаги",
            title2: "Аудит, ККТ, CAPA",
            text: "Контрольные точки, мониторинг, корректирующие действия — в одной системе.",
            href: u("/features/alerts", "haccp", "haccp-alerts"),
            displayPath: "хассп/автоматизация",
          },
        ],
      },
    ],
  },
  {
    slug: "inspections",
    name: "WeSetup · Проверки",
    dailyBudgetRub: 300,
    negativeKeywords: [
      ...GLOBAL_NEGATIVES,
      "налоговая",
      "гибдд",
      "мвд",
      "школы",
    ],
    adGroups: [
      {
        name: "Проверки Роспотребнадзора",
        keywords: [
          "проверка роспотребнадзора",
          "подготовка к проверке роспотребнадзора",
          "штрафы санпин",
          "роспотребнадзор кафе",
          "роспотребнадзор ресторан",
        ],
        ads: [
          {
            title1: "Проверка Роспотребнадзора",
            title2: "Подготовьтесь за сутки",
            text: "Чек-лист, журналы за 12 месяцев в один PDF, подписи комиссий — всё готово.",
            href: u(
              "/blog/proverka-rospotrebnadzora-chek-list",
              "inspections",
              "rospotreb"
            ),
            displayPath: "проверка/чек-лист",
          },
        ],
      },
    ],
  },
  {
    slug: "free-tier",
    name: "WeSetup · Бесплатно",
    dailyBudgetRub: 350,
    negativeKeywords: [
      ...GLOBAL_NEGATIVES,
      "взлом",
      "crack",
      "торрент",
    ],
    adGroups: [
      {
        name: "Бесплатные журналы",
        keywords: [
          "электронный журнал бесплатно",
          "журнал санпин бесплатно",
          "хассп бесплатно",
          "журналы для кафе бесплатно",
          "сервис журналов бесплатно",
        ],
        ads: [
          {
            title1: "Журналы СанПиН бесплатно",
            title2: "Без срока, без карты",
            text: `${JOURNALS_TOTAL_ELECTRONIC_LABEL} для общепита. До 3 сотрудников — навсегда бесплатно.`,
            href: u("/", "free-tier", "free-main"),
            displayPath: "бесплатно",
          },
          {
            title1: "ХАССП онлайн бесплатно",
            title2: "Платите только за команду",
            text: "Весь функционал на любом тарифе. Подписка — когда нужно больше мест.",
            href: u("/", "free-tier", "free-pricing"),
            displayPath: "цены",
          },
        ],
      },
    ],
  },
];
