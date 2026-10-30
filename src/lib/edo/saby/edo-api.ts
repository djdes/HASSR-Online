// Операции ЭДО Saby над исходящими документами: запись черновика, чтение состояния. Это ЕДИНСТВЕННОЕ
// место, которое знает JSON-формы `СБИС.ЗаписатьДокумент` / `СБИС.ПрочитатьДокумент`.
//
// Подпись. Отложенной подписи через API нет (DocsFlow, живой кабинет 23.10.2026: «Не удалось
// определить владельца сертификата для отложенного подписания», документ уходит в 6). Поэтому сайт
// только ЗАПИСЫВАЕТ исходящий черновиком; подписывает КЭП и отправляет его человек в Saby по ссылке
// `СсылкаДляНашаОрганизация`.
//
// Перенесено из DocsFlow (`src/lib/edo/saby/edo-api.ts`, writeDraft / writeAddressedDraft /
// readState). Файл чистый: вызов Saby подставляет вызывающий (`SabyCaller` с готовой сессией).

import { createHash } from "node:crypto";
import { EdoInputError, type OrgRef } from "./orgs";
import { isSabyAppLoginError, SabyRpcError } from "./rpc";
import type { SabyCaller } from "./session";

/**
 * Исходящие типы Saby: счёт, реализация (УПД, акты) и договор. `ДоговорДок` — единое название
 * договора с 25.08.2026 (`ДоговорИсх/Вх` с 10.11.2026 Saby не принимает); живьём 28.10.2026 в DocsFlow.
 */
export type SabyOutgoingType = "СчетИсх" | "ДокОтгрИсх" | "ДоговорДок";

/** Состояние документа в Saby. `code` — `Состояние.Код` строкой. */
export interface SabyDocState {
  id: string;
  code: string;
  label: string;
  /** `СсылкаДляНашаОрганизация` — карточка документа в кабинете (там же ставят подпись). */
  signUrl: string | null;
}

/** Файл для вложения: имя и содержимое в base64. */
export interface SabyFile {
  name: string;
  base64: string;
}

/** Контрагент документа, как его определил Saby: название и ИНН. */
export interface SabyCounterparty {
  name: string;
  inn: string;
}

export interface SabyDraftInfo {
  state: SabyDocState;
  /** `null` — контрагента в ответе нет. */
  counterparty: SabyCounterparty | null;
}

/**
 * Получатель черновика: по реквизитам (ООО — ИНН+КПП+название, ИП — ИНН+ФИО; Saby сам находит
 * абонентский ящик, в том числе в роуминге) или по ID участника ЭДО («2BM-…», «2BE-…»).
 */
export type SabyRecipient = { by: "requisites"; org: OrgRef } | { by: "participant"; id: string };

export interface SabyDraftInput {
  /** Наш GUID документа: повторная запись с тем же id перезаписывает черновик, а не плодит второй. */
  id: string;
  type: SabyOutgoingType;
  ours: OrgRef;
  recipient: SabyRecipient;
  number: string;
  /** `ГГГГ-ММ-ДД`; в Saby уходит `ДД.ММ.ГГГГ`. */
  date: string;
  files: SabyFile[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Строка из значения ответа (числа — тоже: код состояния и ИНН приходят и так, и так). */
function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** «Да»/«Нет» или boolean; null — значение не распознано. */
function flag(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s === "да" || s === "true" || s === "1") return true;
  if (s === "нет" || s === "false" || s === "0") return false;
  return null;
}

/** `ГГГГ-ММ-ДД` → `ДД.ММ.ГГГГ`. Другой формат — ошибка входных данных (до любого вызова Saby). */
export function toSabyDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) throw new EdoInputError(`Некорректная дата документа «${date}»: ожидается формат ГГГГ-ММ-ДД`);
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/**
 * Сторона в виде `НашаОрганизация` / `Контрагент`: ООО — СвЮЛ {ИНН, КПП}, ИП — СвФЛ
 * {ИНН, Фамилия, Имя, Отчество}. Пустые КПП и отчество не отправляем. `withName` — название
 * ЮЛ: Saby требует его у контрагента, которого нет в «Избранных»; у своей организации оно не нужно.
 */
export function sabyParty(org: OrgRef, withName: boolean): Record<string, unknown> {
  if (org.kind === "ip") {
    return {
      СвФЛ: {
        ИНН: org.inn,
        Фамилия: org.lastName,
        Имя: org.firstName,
        ...(org.middleName ? { Отчество: org.middleName } : {}),
      },
    };
  }
  return {
    СвЮЛ: {
      ИНН: org.inn,
      ...(org.kpp ? { КПП: org.kpp } : {}),
      ...(withName && org.name ? { Название: org.name } : {}),
    },
  };
}

/**
 * Идентификатор вложения: UUID, выведенный из id документа и номера вложения. Стабилен между
 * повторными записями одного черновика и не совпадает с id самого документа.
 */
export function attachmentIdFor(docId: string, index = 0): string {
  const seed = index === 0 ? `edo-attachment:${docId}` : `edo-attachment:${docId}:${index}`;
  const h = createHash("sha1").update(seed).digest("hex");
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** Документ из `result`: сам документ, `{Документ: {...}}` или `{Документ: [...]}` — берём первый. */
function docOf(result: unknown): Record<string, unknown> | null {
  const first = Array.isArray(result) ? result[0] : result;
  if (!isRecord(first)) return null;
  const inner = first["Документ"];
  if (inner !== undefined && inner !== null) {
    const d = Array.isArray(inner) ? inner[0] : inner;
    if (isRecord(d)) return d;
  }
  return first;
}

/** Состояние документа. Комментарий к состоянию (причина отказа) дописывается к названию. */
function parseState(doc: Record<string, unknown> | null, fallbackId: string): SabyDocState {
  const st = doc && isRecord(doc["Состояние"]) ? doc["Состояние"] : {};
  const name = str(st["Название"]) || str(st["Описание"]);
  const note = str(st["Примечание"]);
  return {
    id: (doc && str(doc["Идентификатор"])) || fallbackId,
    code: str(st["Код"]),
    label: name && note ? `${name} — ${note}` : name || note,
    signUrl: (doc && str(doc["СсылкаДляНашаОрганизация"])) || null,
  };
}

/** Контрагент документа: ЮЛ — `СвЮЛ.Название`, ИП и физлицо — ФИО из `СвФЛ` (у ИП с префиксом «ИП»). */
function parseCounterparty(doc: Record<string, unknown> | null): SabyCounterparty | null {
  const c = doc && isRecord(doc["Контрагент"]) ? doc["Контрагент"] : null;
  if (!c) return null;
  let found: SabyCounterparty | null = null;
  if (isRecord(c["СвЮЛ"])) {
    const ul = c["СвЮЛ"];
    found = { name: str(ul["Название"]) || str(ul["НазваниеПолное"]), inn: str(ul["ИНН"]) };
  } else if (isRecord(c["СвФЛ"])) {
    const fl = c["СвФЛ"];
    const fio = str(fl["НазваниеПолное"]) || [fl["Фамилия"], fl["Имя"], fl["Отчество"]].map(str).filter(Boolean).join(" ");
    found = { name: fio && str(c["Тип"]) === "ИП" ? `ИП ${fio}` : fio, inn: str(fl["ИНН"]) };
  }
  return found && (found.name || found.inn) ? found : null;
}

/** Классид «ошибка адресации документа или редакции» — Saby отдаёт его в фигурных скобках. */
const ADDRESSING_CLASSID = "1FA000010007";
const NOT_FOUND_TEXT =
  /документ[^.]{0,60}(?:не\s+найден|не\s+существует|отсутствует)|(?:не\s+найден|отсутствует)[^.]{0,30}документ/i;

/**
 * Ответ «такого документа нет»: классид адресации документа либо текст «документ не найден».
 * Отказ входа по ключам и транспортные сбои — не про документ, даже если в тексте «не найдено»
 * (Saby на неверные ключи отвечает «Приложение "…" не найдено!»).
 */
export function isDocNotFound(e: unknown): boolean {
  if (!(e instanceof SabyRpcError)) return false;
  if (isSabyAppLoginError(e)) return false;
  if (e.code.startsWith("http_") || e.code === "timeout" || e.code === "bad_response") return false;
  if (e.code.toUpperCase().includes(ADDRESSING_CLASSID)) return true;
  return NOT_FOUND_TEXT.test(`${e.message} ${e.details ?? ""}`);
}

export interface SabyEdoApi {
  /**
   * Записать исходящий черновиком — один `ЗаписатьДокумент`; повтор с тем же id перезаписывает
   * черновик. Возвращает состояние (код «0», если Saby его не назвал), ссылку и получателя.
   */
  writeDraft(input: SabyDraftInput): Promise<SabyDraftInfo>;
  /** Состояние и получатель; `null` — документа нет (или он удалён: «Удален: Да»). */
  readDraft(id: string): Promise<SabyDraftInfo | null>;
}

/**
 * Удалённый черновик `ПрочитатьДокумент` возвращает как обычный, с прежним «0» и «Удален: Да»
 * (живой ответ 23.10.2026) — для нас такого документа нет.
 */
async function readDoc(call: SabyCaller, id: string): Promise<Record<string, unknown> | null> {
  try {
    const result = await call<unknown>("СБИС.ПрочитатьДокумент", { Документ: { Идентификатор: id } });
    const doc = docOf(result);
    if (!doc || flag(doc["Удален"]) === true) return null;
    return doc;
  } catch (e) {
    if (isDocNotFound(e)) return null;
    throw e;
  }
}

/** Тело `СБИС.ЗаписатьДокумент` — отдельно, чтобы тест сверял форму без сети. */
export function draftParams(input: SabyDraftInput): Record<string, unknown> {
  if (input.files.length === 0) throw new EdoInputError("Нет файла для отправки");
  const number = input.number.trim();
  if (!number) throw new EdoInputError("Укажите номер документа");
  const contractor: Record<string, unknown> =
    input.recipient.by === "participant"
      ? { Идентификатор: input.recipient.id.trim() }
      : sabyParty(input.recipient.org, true);
  if (input.recipient.by === "participant" && !input.recipient.id.trim()) {
    throw new EdoInputError("Укажите ID участника ЭДО получателя");
  }
  return {
    Документ: {
      Идентификатор: input.id,
      Тип: input.type,
      Номер: number,
      Дата: toSabyDate(input.date),
      НашаОрганизация: sabyParty(input.ours, false),
      Контрагент: contractor,
      Вложение: input.files.map((file, index) => ({
        Идентификатор: attachmentIdFor(input.id, index),
        Файл: { Имя: file.name, ДвоичныеДанные: file.base64 },
      })),
      // Регламент не передаём: Saby берёт первый действующий для типа.
    },
  };
}

export function createSabyEdoApi(call: SabyCaller): SabyEdoApi {
  async function readDraft(id: string): Promise<SabyDraftInfo | null> {
    const doc = await readDoc(call, id);
    return doc ? { state: parseState(doc, id), counterparty: parseCounterparty(doc) } : null;
  }

  return {
    async writeDraft(input) {
      const params = draftParams(input);
      const doc = docOf(await call<unknown>("СБИС.ЗаписатьДокумент", params));
      let info: SabyDraftInfo = { state: parseState(doc, input.id), counterparty: parseCounterparty(doc) };
      // Ссылку запись отдаёт не всегда — она есть в ПрочитатьДокумент. По возможности: черновик уже
      // записан, и сбой чтения не должен выглядеть как сбой записи (её бы повторили).
      if (!info.state.signUrl || !info.counterparty) info = (await readDraft(input.id).catch(() => null)) ?? info;
      // Записанный и не отправленный документ — черновик, даже если Saby не назвал код.
      return info.state.code ? info : { ...info, state: { ...info.state, code: "0" } };
    },

    readDraft,
  };
}
