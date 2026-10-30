// «Определение по ИНН»: подключён ли клиент к ЭДО и через какого оператора — метод
// `СБИС.ИнформацияОКонтрагенте` (справка Saby: «возвращает информацию о контрагенте, в том числе
// идентификатор участника документооборота»; https://saby.ru/help/integration/api/all_methods/companyinfo).
//
// Форма запроса и ответа: `params = {"Участник": {"СвЮЛ"|"СвФЛ": {...}, "ДопПоля": "СписокИдентификаторов"}}`.
// Без `ДопПоля` `result.Идентификатор` — строка (ID участника или пусто), с ним — массив абонентских
// ящиков `[{ИдентификаторУчастника, Основной, Роуминг, Оператор{Идентификатор, Название},
// СостояниеПодключения{Код, Описание}, Комментарий}]`. Источник формы — функциональный тест
// клиентской библиотеки magdv/sbis против живого Saby (ответ для ИНН 7601000985: «Основной: Да»,
// «Роуминг: Нет», оператор 2BE «ООО "Компания "Тензор"», состояние 2 «Без аккаунта (отправлено
// приглашение)»). На нашем кабинете ещё не проверено — разбор защитный.
//
// Побочный эффект (справка): контрагента, которого нет в кабинете, Saby добавляет в список
// контрагентов по данным сервиса проверки партнёров. Документ ему мы всё равно отправляем.
// Файл чистый: вызов Saby подставляет вызывающий.

import type { OrgRef } from "./orgs";
import { SabyRpcError } from "./rpc";
import type { SabyCaller } from "./session";

/** Абонентский ящик контрагента в ЭДО. */
export interface CounterpartyBox {
  participantId: string;
  /** Код оператора ЭДО («2BE» — Тензор/Saby, «2BM» — Контур.Диадок…); пусто — не определили. */
  operatorCode: string;
  operatorName: string;
  /** Ящик у другого оператора, документы идут через роуминг. null — Saby не сказал. */
  roaming: boolean | null;
  main: boolean | null;
  statusCode: string;
  statusText: string;
}

/**
 * Итог проверки: `saby` — клиент в ЭДО Saby напрямую; `roaming` — у другого оператора, Saby
 * доставит через роуминг; `invited` — приглашение уже отправлено, клиент ещё не подключился;
 * `none` — идентификатора участника нет (не подключён или отказался) — при отправке Saby
 * предложит пригласить его по реквизитам.
 */
export type CounterpartyEdoKind = "saby" | "roaming" | "invited" | "none";

export interface CounterpartyEdo {
  kind: CounterpartyEdoKind;
  /** Основной ящик (по нему Saby отправит документ по реквизитам); null — ящиков нет. */
  box: CounterpartyBox | null;
  boxes: CounterpartyBox[];
  /** Как Saby назвал контрагента (по сервису проверки партнёров). */
  name: string;
  inn: string;
}

/** Код оператора ЭДО Тензора (Saby), назначенный ФНС. */
export const SABY_OPERATOR_CODE = "2BE";

/** Известные коды операторов ЭДО — только для подписи, когда Saby не прислал название. */
const OPERATOR_NAMES: Record<string, string> = {
  "2BE": "Saby (Тензор)",
  "2BM": "Контур.Диадок",
  "2AL": "Такском",
  "2AE": "Калуга Астрал",
};

/** Подпись оператора: название от Saby, иначе по коду, иначе «оператор 2XX». */
export function operatorLabel(code: string, name: string): string {
  const n = name.trim();
  if (n) return n;
  const c = code.trim().toUpperCase();
  if (!c) return "";
  return OPERATOR_NAMES[c] ?? `оператор ${c}`;
}

/** Код оператора из ID участника: первые три символа до дефиса («2BM-…» → «2BM»). */
export function operatorCodeFromParticipantId(id: string): string {
  const m = /^([0-9A-Za-z]{3})-/.exec(id.trim());
  return m ? m[1].toUpperCase() : "";
}

/**
 * ID участника ЭДО: код оператора (3 знака), дефис и код участника. Пробелы из копирования
 * убираем, код оператора — в верхний регистр. Не похоже на ID — `null`.
 */
export function normalizeParticipantId(raw: string): string | null {
  const s = raw.replace(/[\s ​]+/g, "");
  const m = /^([0-9A-Za-z]{3})-([0-9A-Za-z][0-9A-Za-z-]*)$/.exec(s);
  if (!m) return null;
  const id = `${m[1].toUpperCase()}-${m[2]}`;
  return id.length <= 100 ? id : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function flag(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s === "да" || s === "true" || s === "1") return true;
  if (s === "нет" || s === "false" || s === "0") return false;
  return null;
}

/** Тело запроса: контрагент по реквизитам, с названием у ЮЛ (как в справке SDK). */
export function counterpartyInfoParams(org: OrgRef, withBoxes = true): Record<string, unknown> {
  const member: Record<string, unknown> =
    org.kind === "ip"
      ? {
          СвФЛ: {
            ИНН: org.inn,
            Фамилия: org.lastName,
            Имя: org.firstName,
            ...(org.middleName ? { Отчество: org.middleName } : {}),
          },
        }
      : {
          СвЮЛ: {
            ИНН: org.inn,
            ...(org.kpp ? { КПП: org.kpp } : {}),
            ...(org.name ? { Название: org.name } : {}),
          },
        };
  if (withBoxes) member["ДопПоля"] = "СписокИдентификаторов";
  return { Участник: member };
}

function parseBox(raw: unknown): CounterpartyBox | null {
  if (!isRecord(raw)) return null;
  const participantId = str(raw["ИдентификаторУчастника"]) || str(raw["Идентификатор"]);
  const op = isRecord(raw["Оператор"]) ? raw["Оператор"] : {};
  const st = isRecord(raw["СостояниеПодключения"]) ? raw["СостояниеПодключения"] : {};
  const operatorCode = (str(op["Идентификатор"]) || operatorCodeFromParticipantId(participantId)).toUpperCase();
  if (!participantId && !operatorCode) return null;
  return {
    participantId,
    operatorCode,
    operatorName: str(op["Название"]),
    roaming: flag(raw["Роуминг"]),
    main: flag(raw["Основной"]),
    statusCode: str(st["Код"]),
    statusText: str(st["Описание"]) || str(st["Название"]),
  };
}

/** Состояние ящика говорит, что клиент только приглашён («Без аккаунта (отправлено приглашение)»). */
function isInvitedOnly(box: CounterpartyBox): boolean {
  return /без\s+аккаунта|приглашени/i.test(box.statusText);
}

/** Разбор ответа (защитный: `Идентификатор` — строка, массив ящиков или один объект). */
export function parseCounterpartyInfo(result: unknown): CounterpartyEdo {
  const root = isRecord(result) && isRecord(result["Участник"]) ? result["Участник"] : isRecord(result) ? result : {};
  const rawId = root["Идентификатор"];
  let boxes: CounterpartyBox[] = [];
  if (Array.isArray(rawId)) boxes = rawId.map(parseBox).filter((b): b is CounterpartyBox => b !== null);
  else if (isRecord(rawId)) boxes = [parseBox(rawId)].filter((b): b is CounterpartyBox => b !== null);
  else if (str(rawId)) {
    const participantId = str(rawId);
    const operatorCode = operatorCodeFromParticipantId(participantId);
    boxes = [{ participantId, operatorCode, operatorName: "", roaming: operatorCode ? operatorCode !== SABY_OPERATOR_CODE : null, main: true, statusCode: "", statusText: "" }];
  }
  // Ящики могли прийти и отдельным полем (другая редакция ответа).
  if (boxes.length === 0 && Array.isArray(root["АбонентскийЯщик"])) {
    boxes = (root["АбонентскийЯщик"] as unknown[]).map(parseBox).filter((b): b is CounterpartyBox => b !== null);
  }

  const ul = isRecord(root["СвЮЛ"]) ? root["СвЮЛ"] : null;
  const fl = isRecord(root["СвФЛ"]) ? root["СвФЛ"] : null;
  const name = ul
    ? str(ul["Название"]) || str(ul["НазваниеПолное"])
    : fl
      ? str(fl["НазваниеПолное"]) || [fl["Фамилия"], fl["Имя"], fl["Отчество"]].map(str).filter(Boolean).join(" ")
      : "";
  const inn = str((ul ?? fl ?? {})["ИНН"]);

  const box = boxes.find((b) => b.main === true) ?? boxes[0] ?? null;
  let kind: CounterpartyEdoKind;
  if (!box || !box.participantId) kind = "none";
  else if (isInvitedOnly(box)) kind = "invited";
  else if (box.roaming === true || (box.roaming === null && box.operatorCode && box.operatorCode !== SABY_OPERATOR_CODE)) kind = "roaming";
  else kind = "saby";
  return { kind, box, boxes, name, inn };
}

/** -32602 «неверные параметры» — Saby не принял состав полей (например, `ДопПоля`). */
function isInvalidParams(e: unknown): boolean {
  return e instanceof SabyRpcError && (e.code === "-32602" || /-32602/.test(e.code));
}

/**
 * Проверка получателя по реквизитам. Сначала со списком ящиков (`ДопПоля`), а если Saby не принял
 * такой состав полей (-32602) — один повтор без него: ID участника тоже скажет, кто оператор.
 */
export async function checkCounterpartyEdo(call: SabyCaller, org: OrgRef): Promise<CounterpartyEdo> {
  try {
    return parseCounterpartyInfo(await call<unknown>("СБИС.ИнформацияОКонтрагенте", counterpartyInfoParams(org, true)));
  } catch (e) {
    if (!isInvalidParams(e)) throw e;
    return parseCounterpartyInfo(await call<unknown>("СБИС.ИнформацияОКонтрагенте", counterpartyInfoParams(org, false)));
  }
}
