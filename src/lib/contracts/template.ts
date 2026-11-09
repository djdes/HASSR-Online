/**
 * Шаблон договора WeSetup (ООО «БФС» → клиент) на оказание услуг по
 * предоставлению доступа к сервису электронных журналов.
 *
 * Версия «2026-11-09»: текст составлен по образцу владельца — короткий
 * договор из 11 разделов (предмет, права и обязанности, стоимость и
 * расчёты, срок, ответственность, конфиденциальность, интеллектуальная
 * собственность, непреодолимая сила, споры, прочие условия, реквизиты).
 * Сумм в тексте нет: тариф, срок и стоимость — в Счёте (п. 1.2).
 * ⚠ Перед использованием текст должен вычитать юрист.
 *
 * Любое изменение текста — новая `CONTRACT_TEMPLATE_VERSION`. Выпущенные
 * договоры перерисовываются из снимка с текстом своей версии: прежняя
 * редакция лежит в `sections-2026-10-29.ts` и не меняется.
 *
 * Модуль чистый (без базы и файлов): его зовут PDF/DOCX-рендеры и тесты.
 */

import {
  BLANK,
  BLANK_SHORT,
  NBSP,
  clean,
  contractDateLong,
  ogrnLabelFor,
  orBlank,
  parseContractDate,
  personName,
  postAsTitle,
  postInSentence,
  shortPersonName,
} from "./format";
import {
  REQUISITES_TITLE_2026_10_29,
  SUBTITLE_2026_10_29,
  TEMPLATE_VERSION_2026_10_29,
  sections20261029,
  type ContractSectionSource,
} from "./sections-2026-10-29";
import type { ContractBuyer, ContractSeller, ContractSnapshot } from "./types";

export const CONTRACT_TEMPLATE_VERSION = "2026-11-09";

const SUBTITLE = "на оказание услуг по предоставлению доступа к сервису электронных журналов WeSetup";
const REQUISITES_TITLE = "Реквизиты и подписи сторон";

export const CONTRACT_TITLE = "Договор оказания услуг";

export type ContractBlock =
  /** Пункт с номером «3.2.». */
  | { kind: "clause"; num: string; text: string }
  /** Подпункт «а)» под пунктом. */
  | { kind: "item"; marker: string; text: string };

export type ContractSection = { num: number; title: string; blocks: ContractBlock[] };

export type RequisiteRow = { label: string; value: string; strong?: boolean };

export type SignatureSide = {
  role: "Исполнитель" | "Заказчик";
  orgName: string;
  post: string;
  nameShort: string;
  /** Строка над подписью: «Генеральный директор ООО «БФС»», «Индивидуальный предприниматель». */
  caption: string;
};

export type ContractDocument = {
  title: string;
  /** Строка под заголовком: предмет договора. */
  subtitle: string;
  number: string;
  /** Номер ещё не присвоен — черновик для проверки. */
  draft: boolean;
  /** Договор аннулирован — на листах предупреждение (ставит render.server). */
  voided?: boolean;
  dateLong: string;
  city: string;
  preamble: string;
  sections: ContractSection[];
  requisites: { seller: RequisiteRow[]; buyer: RequisiteRow[] };
  signatures: { seller: SignatureSide; buyer: SignatureSide };
  /** Подпись под каждым листом: «Договор № … от …». */
  runningTitle: string;
  /** Для кого какое основание — показывается в шапке письма и списке. */
  parties: { seller: string; buyer: string };
  templateVersion: string;
};

/**
 * Типографика: неразрывный пробел после «п.», «ст.», «№» и т. п. и между
 * числом и скобкой с прописью — чтобы «п. 3.2» и «10 (десять)» не
 * разрывались переносом строки.
 */
export function typo(text: string): string {
  return text
    .replace(/(^|[\s(«])(п|пп|подп|ст|ч|разд|гл|г|т|стр)\. /g, `$1$2.${NBSP}`)
    .replace(/№ /g, `№${NBSP}`)
    .replace(/(\d) \(/g, `$1${NBSP}(`)
    .replace(/ —/g, `${NBSP}—`)
    .replace(/(\d) (%|руб\.|рабочих|календарных|банковских|часов|месяц|лет|года?)/g, `$1${NBSP}$2`);
}

const INDIVIDUAL_PREFIX = /^(индивидуальный\s+предприниматель|ип)\s+/i;

/** ФИО предпринимателя из наименования «ИП Иванов Иван Иванович». */
export function individualName(buyer: Pick<ContractBuyer, "nameFull" | "nameShort">): string | null {
  for (const candidate of [buyer.nameFull, buyer.nameShort]) {
    const text = clean(candidate);
    if (text && INDIVIDUAL_PREFIX.test(text)) return personName(text.replace(INDIVIDUAL_PREFIX, ""));
  }
  return null;
}

function sellerParty(seller: ContractSeller): string {
  const short = clean(seller.nameShort);
  const name = short && short !== seller.nameFull ? `${seller.nameFull} (${short})` : seller.nameFull;
  const post = postInSentence(seller.head.post) ?? "генеральный директор";
  return `${name}, ИНН ${seller.inn}, ${ogrnLabelFor("legal", seller.ogrn)} ${seller.ogrn} (далее — «Исполнитель»), от имени которого на основании Устава действует ${post} ${personName(seller.head.name) ?? BLANK}`;
}

/**
 * ИП подписывает сам. Представитель — только когда указаны и основание
 * (доверенность), и ФИО, отличное от ФИО предпринимателя.
 */
function individualRepresentative(buyer: ContractBuyer, params: ContractSnapshot["params"]): { fio: string | null; representative: string | null; basis: string | null } {
  const fio = individualName(buyer) ?? personName(params.signerName);
  const signer = personName(params.signerName);
  const basis = clean(params.signerBasis);
  return { fio, representative: basis && signer && signer !== fio ? signer : null, basis };
}

function buyerParty(buyer: ContractBuyer, params: ContractSnapshot["params"]): string {
  const ogrnLabel = ogrnLabelFor(buyer.kind, buyer.ogrn);
  const ids = [`ИНН ${orBlank(buyer.inn, BLANK_SHORT)}`, `${ogrnLabel} ${orBlank(buyer.ogrn, BLANK_SHORT)}`].join(", ");
  if (buyer.kind === "individual") {
    const { fio, representative, basis } = individualRepresentative(buyer, params);
    const name = `Индивидуальный предприниматель ${fio ?? BLANK}`;
    const tail = representative ? `, от имени которого на основании ${basis} действует представитель ${representative}` : "";
    return `${name}, ${ids} (далее — «Заказчик»)${tail}`;
  }
  const short = clean(buyer.nameShort);
  const name = short && short !== buyer.nameFull ? `${buyer.nameFull} (${short})` : buyer.nameFull;
  const basis = orBlank(params.signerBasis, BLANK_SHORT);
  const post = postInSentence(params.signerPost) ?? BLANK_SHORT;
  const signer = personName(params.signerName) ?? BLANK;
  return `${name}, ${ids} (далее — «Заказчик»), от имени которого на основании ${basis} действует ${post} ${signer}`;
}

/** Дата окончания первого года действия договора: та же дата следующего года (29 февраля → 28 февраля). */
export function contractEndDate(date: string): string {
  const parts = parseContractDate(date);
  if (!parts) return date;
  const day = parts.month === 2 && parts.day === 29 ? 28 : parts.day;
  return `${parts.year + 1}-${String(parts.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Разделы договора. Ссылки «п. X.Y» и «разд. N» проверяет тест. */
function sections(seller: ContractSeller, date: string): ContractSectionSource[] {
  const site = clean(seller.site) ?? "wesetup.ru";
  const vat =
    seller.vatMode === "none"
      ? "Услуги НДС не облагаются: Исполнитель применяет упрощённую систему налогообложения."
      : "Стоимость услуг включает НДС по ставке, установленной законодательством Российской Федерации.";

  return [
    {
      title: "Предмет договора",
      blocks: [
        `Исполнитель обязуется оказывать Заказчику услуги по предоставлению доступа к сервису электронных журналов «WeSetup» (далее — Сервис), размещённому в сети Интернет по адресу https://${site}, и по его обслуживанию, а Заказчик обязуется принять и оплатить эти услуги.`,
        "Тариф, количество объектов Заказчика (торговых точек), срок доступа и стоимость услуг указываются в счёте Исполнителя (далее — Счёт). Счёт, оплаченный Заказчиком, является неотъемлемой частью Договора.",
        "В состав услуг входят:",
        ["а)", "предоставление доступа к Сервису в объёме тарифа;"],
        ["б)", "настройка основных параметров Сервиса в объёме тарифа;"],
        ["в)", "хранение данных, внесённых Заказчиком в Сервис;"],
        ["г)", "обновление Сервиса и исправление ошибок в его работе;"],
        ["д)", "консультации по работе с Сервисом."],
        "Услуги оказываются удалённо, без выезда на территорию Заказчика.",
        "Оказание услуг начинается с даты поступления оплаты на расчётный счёт Исполнителя.",
        "Дополнительные услуги (разработка программы производственного контроля и документов системы ХАССП, обучение работников Заказчика) и поставка оборудования выполняются на основании отдельного Счёта.",
        "Сервис предназначен для ведения документации. Заполнение журналов, производственный контроль и соблюдение санитарных требований на объектах Заказчика остаются обязанностью Заказчика.",
      ],
    },
    {
      title: "Права и обязанности сторон",
      blocks: [
        "Исполнитель обязуется:",
        ["а)", "предоставить доступ к Сервису не позднее 1 (одного) рабочего дня с даты поступления оплаты;"],
        ["б)", "обеспечивать работу Сервиса и резервное копирование данных Заказчика;"],
        ["в)", "консультировать Заказчика по работе с Сервисом в рабочие дни с 10:00 до 19:00 по московскому времени;"],
        ["г)", "устранять за свой счёт сбои в работе Сервиса, возникшие по причинам, зависящим от Исполнителя."],
        "Исполнитель вправе:",
        ["а)", "приостановить оказание услуг, если Заказчик не оплатил очередной период (разд. 3);"],
        ["б)", "самостоятельно определять способы оказания услуг, изменять и обновлять Сервис без уменьшения объёма оплаченного тарифа;"],
        ["в)", "проводить технические работы с временным ограничением доступа к Сервису;"],
        ["г)", "привлекать к оказанию услуг третьих лиц, отвечая за их действия перед Заказчиком."],
        "Заказчик обязуется:",
        ["а)", "принимать и оплачивать услуги в порядке и в сроки, установленные разд. 3;"],
        ["б)", "вносить в Сервис достоверные данные;"],
        ["в)", "не передавать логины и пароли лицам, не являющимся его работниками; действия, совершённые с использованием учётных данных Заказчика, считаются действиями Заказчика;"],
        ["г)", "сообщать Исполнителю об изменении своих реквизитов и адреса электронной почты в течение 5 (пяти) рабочих дней."],
        "Заказчик вправе:",
        ["а)", "пользоваться Сервисом в объёме оплаченного тарифа;"],
        ["б)", "проверять ход и качество оказания услуг, не вмешиваясь в деятельность Исполнителя;"],
        ["в)", "выгружать свои данные из Сервиса в течение оплаченного периода."],
      ],
    },
    {
      title: "Стоимость услуг и порядок расчётов",
      blocks: [
        "Стоимость услуг определяется тарифами Исполнителя, действующими на дату выставления Счёта, и указывается в Счёте.",
        "Заказчик оплачивает услуги на условиях 100 % предоплаты за выбранный период (месяц или год) в течение 5 (пяти) банковских дней с даты выставления Счёта, если в Счёте не указан иной срок.",
        "Расчёты производятся в рублях Российской Федерации безналичным перечислением на расчётный счёт Исполнителя. Обязательство по оплате считается исполненным в день зачисления денежных средств на расчётный счёт Исполнителя.",
        vat,
        "Стоимость оплаченного периода изменению не подлежит. Об изменении тарифов на следующие периоды Исполнитель уведомляет Заказчика не менее чем за 10 (десять) календарных дней.",
        "По каждому оплаченному Счёту Исполнитель направляет Заказчику универсальный передаточный документ (УПД) или акт оказанных услуг. Заказчик подписывает документ в течение 5 (пяти) рабочих дней с даты получения либо в тот же срок направляет мотивированный отказ. Если отказ не направлен, услуги считаются принятыми.",
        "Стороны обмениваются документами через оператора электронного документооборота (ЭДО). Если Заказчик не использует ЭДО, документы направляются по электронной почте; оригиналы на бумажном носителе направляются по запросу Заказчика, доставка — за его счёт.",
      ],
    },
    {
      title: "Срок действия договора",
      blocks: [
        `Договор вступает в силу с даты подписания, а если Счёт оплачен раньше — с даты оплаты, и действует до ${contractDateLong(contractEndDate(date))}`,
        "Договор продлевается на каждый следующий год, если ни одна из Сторон не позднее чем за 30 (тридцать) календарных дней до окончания срока его действия письменно не заявила о прекращении Договора.",
        "Договор может быть расторгнут по соглашению Сторон, по письменному уведомлению одной из Сторон, направленному не менее чем за 10 (десять) календарных дней до даты расторжения, либо в ином порядке, установленном законодательством Российской Федерации.",
        "При досрочном расторжении Договора Исполнитель возвращает Заказчику оплату за неиспользованные полные месяцы оплаченного периода в течение 10 (десяти) рабочих дней с даты расторжения. Если период оплачен со скидкой за длительный срок, использованное время пересчитывается по цене помесячной оплаты того же тарифа. Стоимость оказанных дополнительных услуг и поставленного оборудования не возвращается.",
        "После прекращения Договора Исполнитель хранит данные Заказчика 30 (тридцать) календарных дней, после чего вправе их удалить.",
      ],
    },
    {
      title: "Ответственность сторон",
      blocks: [
        "За неисполнение или ненадлежащее исполнение Договора Стороны несут ответственность в соответствии с законодательством Российской Федерации.",
        "Исполнитель отвечает за работоспособность Сервиса и качество выполненных им настроек. Если Сервис был недоступен по причинам, зависящим от Исполнителя, более 24 (двадцати четырёх) часов подряд, оплаченный период продлевается на время недоступности.",
        "Исполнитель не несёт ответственности:",
        ["а)", "за сбои в работе оборудования, программного обеспечения и каналов связи Заказчика и третьих лиц;"],
        ["б)", "за содержание, полноту и достоверность данных, внесённых Заказчиком;"],
        ["в)", "за результаты проверок контрольных (надзорных) органов и за санкции, применённые к Заказчику."],
        "Ответственность Исполнителя ограничена реальным ущербом в пределах стоимости услуг за период, в котором допущено нарушение. Упущенная выгода возмещению не подлежит.",
      ],
    },
    {
      title: "Конфиденциальность и персональные данные",
      blocks: [
        "Стороны обязуются не разглашать третьим лицам сведения о деятельности другой Стороны, полученные при исполнении Договора, в течение срока действия Договора и 3 (трёх) лет после его прекращения, за исключением случаев, предусмотренных законодательством Российской Федерации.",
        "Данные, внесённые Заказчиком в Сервис, принадлежат Заказчику. Исполнитель использует их только для исполнения Договора.",
        "Заказчик является оператором персональных данных своих работников и поручает Исполнителю их обработку в соответствии с ч. 3 ст. 6 Федерального закона от 27.07.2006 № 152-ФЗ «О персональных данных» с целью исполнения Договора. Перечень данных: фамилия, имя, отчество, должность, номер телефона, адрес электронной почты, сведения, предусмотренные формами журналов. Действия с данными: сбор, запись, систематизация, накопление, хранение, уточнение, использование, предоставление доступа работникам Заказчика, блокирование, удаление, уничтожение — с использованием средств автоматизации.",
        "Исполнитель соблюдает конфиденциальность персональных данных, обеспечивает их безопасность в соответствии со ст. 18.1 и ст. 19 Федерального закона № 152-ФЗ, хранит их на территории Российской Федерации и уведомляет Заказчика об инциденте с персональными данными в течение 24 (двадцати четырёх) часов с момента его выявления.",
        "Заказчик обеспечивает наличие правовых оснований для обработки персональных данных и для поручения их обработки Исполнителю.",
      ],
    },
    {
      title: "Интеллектуальная собственность",
      blocks: [
        "Исключительные права на Сервис принадлежат Исполнителю. На оплаченный период Исполнитель предоставляет Заказчику право использования Сервиса на условиях простой (неисключительной) лицензии; вознаграждение за лицензию включено в стоимость услуг.",
        "Заказчик не вправе копировать, изменять и декомпилировать Сервис, а также передавать доступ к нему третьим лицам.",
        "При нарушении п. 7.2 Заказчик возмещает Исполнителю причинённые убытки.",
      ],
    },
    {
      title: "Обстоятельства непреодолимой силы",
      blocks: [
        "Стороны освобождаются от ответственности за неисполнение обязательств по Договору, если оно вызвано обстоятельствами непреодолимой силы: стихийными бедствиями, пожарами, эпидемиями, авариями, военными действиями, актами органов власти.",
        "Сторона, для которой возникли такие обстоятельства, уведомляет другую Сторону в течение 5 (пяти) рабочих дней. Срок исполнения обязательств переносится на время действия этих обстоятельств.",
        "Если обстоятельства непреодолимой силы действуют более 2 (двух) месяцев подряд, каждая Сторона вправе расторгнуть Договор, уведомив другую Сторону.",
      ],
    },
    {
      title: "Разрешение споров",
      blocks: [
        "Споры по Договору Стороны разрешают путём переговоров. Претензионный порядок обязателен; срок ответа на претензию — 15 (пятнадцать) рабочих дней с даты её получения.",
        "Споры, не урегулированные в претензионном порядке, рассматриваются арбитражным судом по месту нахождения Исполнителя.",
      ],
    },
    {
      title: "Прочие условия",
      blocks: [
        "Изменения и дополнения к Договору действительны, если они совершены в письменной форме и подписаны обеими Сторонами.",
        "Договор, дополнительные соглашения к нему, Счета, УПД, акты и уведомления, направленные через оператора ЭДО или по адресам электронной почты, указанным в разд. 11, имеют юридическую силу. Документы, подписанные усиленной квалифицированной электронной подписью, равнозначны документам на бумажном носителе.",
        "Стороны допускают использование факсимильного воспроизведения подписи и оттиска печати Исполнителя на Договоре, Счетах и иных документах по Договору (п. 2 ст. 160 ГК РФ).",
        "Во всём, что не предусмотрено Договором, Стороны руководствуются законодательством Российской Федерации.",
        "Договор составлен в двух экземплярах, имеющих равную юридическую силу, по одному для каждой Стороны, либо в форме электронного документа.",
      ],
    },
  ];
}

function sellerRequisites(seller: ContractSeller): RequisiteRow[] {
  return [
    { label: "Наименование", value: seller.nameFull, strong: true },
    { label: "ИНН / КПП", value: `${seller.inn} / ${orBlank(seller.kpp, BLANK_SHORT)}` },
    { label: ogrnLabelFor("legal", seller.ogrn), value: seller.ogrn },
    { label: "Юридический адрес", value: seller.address },
    { label: "Банк", value: seller.bank.name },
    { label: "БИК", value: seller.bank.bik },
    { label: "Расчётный счёт", value: seller.bank.account },
    { label: "Корр. счёт", value: seller.bank.corrAccount },
    { label: "Телефон", value: orBlank(seller.phone, BLANK_SHORT) },
    { label: "Эл. почта", value: orBlank(seller.email, BLANK_SHORT) },
  ];
}

/**
 * Наименования заказчика для реквизитов и подписи. У ИП без снимка ЕГРЮЛ
 * в организации лежит только название в сервисе («Кафе у дома») — оно не
 * сторона договора, поэтому пишем «Индивидуальный предприниматель ФИО»
 * (или линию, если ФИО неизвестно).
 */
function buyerNames(buyer: ContractBuyer, fio: string | null): { full: string; short: string } {
  if (buyer.kind === "individual") {
    const full = INDIVIDUAL_PREFIX.test(buyer.nameFull) ? buyer.nameFull : `Индивидуальный предприниматель ${fio ?? BLANK}`;
    const short = clean(buyer.nameShort) && INDIVIDUAL_PREFIX.test(buyer.nameShort) ? buyer.nameShort : `ИП ${shortPersonName(fio) ?? BLANK_SHORT}`;
    return { full, short };
  }
  return { full: buyer.nameFull, short: clean(buyer.nameShort) ?? buyer.nameFull };
}

/** Краткое имя заказчика для списков и писем («ООО «Ромашка»», «ИП Петров П. П.»). */
export function buyerDisplayName(buyer: ContractBuyer, params: ContractSnapshot["params"]): string {
  const fio = buyer.kind === "individual" ? individualRepresentative(buyer, params).fio : null;
  return buyerNames(buyer, fio).short;
}

function buyerRequisites(buyer: ContractBuyer, fullName: string): RequisiteRow[] {
  const rows: RequisiteRow[] = [
    { label: "Наименование", value: fullName, strong: true },
    buyer.kind === "individual"
      ? { label: "ИНН", value: orBlank(buyer.inn, BLANK_SHORT) }
      : { label: "ИНН / КПП", value: `${orBlank(buyer.inn, BLANK_SHORT)} / ${orBlank(buyer.kpp, BLANK_SHORT)}` },
    { label: ogrnLabelFor(buyer.kind, buyer.ogrn), value: orBlank(buyer.ogrn, BLANK_SHORT) },
    { label: buyer.kind === "individual" ? "Адрес" : "Юридический адрес", value: orBlank(buyer.legalAddress) },
  ];
  if (clean(buyer.actualAddress) && buyer.actualAddress !== buyer.legalAddress) {
    rows.push({ label: "Фактический адрес", value: buyer.actualAddress as string });
  }
  // Банковских реквизитов клиента в базе нет — линии для ручного заполнения.
  rows.push(
    { label: "Банк", value: BLANK },
    { label: "БИК", value: BLANK_SHORT },
    { label: "Расчётный счёт", value: BLANK },
    { label: "Корр. счёт", value: BLANK },
    { label: "Телефон", value: orBlank(buyer.phone, BLANK_SHORT) },
    { label: "Эл. почта", value: orBlank(buyer.email, BLANK_SHORT) },
  );
  return rows;
}

/** Собирает текст договора из снимка. Номер черновика — «WS-2026/____». */
export function buildContractDocument(snapshot: ContractSnapshot): ContractDocument {
  const { seller, buyer, params } = snapshot;
  const draft = snapshot.number.includes("_");
  // Договор, выпущенный с прежней версией шаблона, сохраняет свой текст.
  const legacy = snapshot.templateVersion === TEMPLATE_VERSION_2026_10_29;
  const source = legacy ? sections20261029(seller, buyer) : sections(seller, snapshot.date);
  const builtSections: ContractSection[] = source.map((section, index) => {
    const num = index + 1;
    let clause = 0;
    const blocks: ContractBlock[] = section.blocks.map((block) => {
      if (Array.isArray(block)) return { kind: "item", marker: block[0], text: typo(block[1]) };
      clause += 1;
      return { kind: "clause", num: `${num}.${clause}.`, text: typo(block) };
    });
    return { num, title: section.title, blocks };
  });
  // Раздел реквизитов — последний, после текста (на его номер ссылается текст договора).
  builtSections.push({ num: builtSections.length + 1, title: legacy ? REQUISITES_TITLE_2026_10_29 : REQUISITES_TITLE, blocks: [] });

  const individual = buyer.kind === "individual" ? individualRepresentative(buyer, params) : null;
  const names = buyerNames(buyer, individual?.fio ?? null);
  const sellerShort = clean(seller.nameShort) ?? seller.nameFull;
  const sellerPost = postAsTitle(seller.head.post) ?? "Генеральный директор";
  const buyerSigner: Pick<SignatureSide, "post" | "nameShort" | "caption"> = individual
    ? individual.representative
      ? {
          post: "Представитель по доверенности",
          nameShort: shortPersonName(individual.representative) ?? BLANK_SHORT,
          caption: `Представитель по доверенности ${names.short}`,
        }
      : { post: "Индивидуальный предприниматель", nameShort: shortPersonName(individual.fio) ?? BLANK_SHORT, caption: "Индивидуальный предприниматель" }
    : {
        post: postAsTitle(params.signerPost) ?? BLANK_SHORT,
        nameShort: shortPersonName(params.signerName) ?? BLANK_SHORT,
        caption: `${postAsTitle(params.signerPost) ?? BLANK_SHORT} ${names.short}`,
      };
  const dateLong = contractDateLong(snapshot.date);
  const city = clean(snapshot.city);

  return {
    title: CONTRACT_TITLE,
    subtitle: legacy ? SUBTITLE_2026_10_29 : SUBTITLE,
    number: snapshot.number,
    draft,
    dateLong,
    city: city ? `г. ${city}` : `г. ${BLANK_SHORT}`,
    preamble: typo(
      `${sellerParty(seller)}, с одной стороны, и ${buyerParty(buyer, params)}, с другой стороны, вместе именуемые «Стороны», заключили настоящий договор (далее — «Договор») о нижеследующем.`,
    ),
    sections: builtSections,
    requisites: { seller: sellerRequisites(seller), buyer: buyerRequisites(buyer, names.full) },
    signatures: {
      seller: {
        role: "Исполнитель",
        orgName: sellerShort,
        post: sellerPost,
        nameShort: shortPersonName(seller.head.name) ?? BLANK_SHORT,
        caption: `${sellerPost} ${sellerShort}`,
      },
      buyer: { role: "Заказчик", orgName: names.short, ...buyerSigner },
    },
    runningTitle: `Договор № ${snapshot.number} от ${dateLong}`.replace(/№ /, `№${NBSP}`),
    parties: { seller: sellerShort, buyer: names.short },
    templateVersion: snapshot.templateVersion,
  };
}

/** Весь текст договора одной строкой — для тестов и поиска пропусков. */
export function contractPlainText(document: ContractDocument): string {
  const parts: string[] = [
    `${document.title} № ${document.number}`,
    document.city,
    document.dateLong,
    document.preamble,
  ];
  for (const section of document.sections) {
    parts.push(`${section.num}. ${section.title}`);
    for (const block of section.blocks) parts.push(block.kind === "clause" ? `${block.num} ${block.text}` : `${block.marker} ${block.text}`);
  }
  for (const row of [...document.requisites.seller, ...document.requisites.buyer]) parts.push(`${row.label}: ${row.value}`);
  for (const side of [document.signatures.seller, document.signatures.buyer]) parts.push(`${side.role}: ${side.caption} ${side.nameShort}`);
  return parts.join("\n");
}

export { BLANK, BLANK_SHORT };
