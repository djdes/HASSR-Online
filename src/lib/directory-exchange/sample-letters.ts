import type { ExchangeKind } from "@/lib/directory-exchange/kinds";
import {
  ownerRequestLetter,
  requesterDecisionLetter,
  type RequestLetter,
} from "@/lib/directory-exchange/request-letters";
import { requestExpiresAt } from "@/lib/directory-exchange/requests";

/**
 * Образцы писем обмена справочниками с чужим аккаунтом для проверки на проде
 * (серия A, Р3): ROOT отправляет их себе и видит, приняла ли письма почта.
 * Данные — заведомо выдуманные («Пример: …»), тема — с пометкой «[Проверка] »,
 * чтобы образец нельзя было принять за настоящий запрос.
 */

export const SAMPLE_LETTER_SUBJECT_PREFIX = "[Проверка] ";
export const SAMPLE_REQUESTER_NAME = "Пример: Кафе Партнёр";
export const SAMPLE_CABINET_NAME = "Пример: Мастер-кабинет";
export const SAMPLE_LETTER_PATH = "/settings/master-cabinet";

export const SAMPLE_LETTER_KINDS = ["request", "decision"] as const;
export type SampleLetterKind = (typeof SAMPLE_LETTER_KINDS)[number];

export type SampleLetter = { kind: SampleLetterKind; letter: RequestLetter };

/** Ответ `POST /api/root/directory-exchange/test-letters`. */
export type SampleLettersResult = {
  ok: true;
  /** Почта настроена (SMTP); false — письма только записаны в журнал сервера. */
  configured: boolean;
  to: string;
  letters: Array<{ kind: SampleLetterKind; delivered: boolean }>;
};

/** Отправлять некуда: у учётной записи нет рабочей почты. */
export type SampleLettersRefusal = { ok: false; code: "no_email"; error: string };

/** Оба образца: письмо владельцу кабинета о запросе и письмо заявителю о решении. */
export function sampleExchangeLetters(appUrl: string, now: Date): SampleLetter[] {
  const url = `${appUrl.replace(/\/+$/, "")}${SAMPLE_LETTER_PATH}`;
  const kinds: ExchangeKind[] = ["products", "staff"];
  const mark = (letter: RequestLetter): RequestLetter => ({
    ...letter,
    subject: `${SAMPLE_LETTER_SUBJECT_PREFIX}${letter.subject}`,
  });
  return [
    {
      kind: "request",
      letter: mark(
        ownerRequestLetter({
          url,
          mode: "link",
          kinds,
          cabinetName: SAMPLE_CABINET_NAME,
          requesterName: SAMPLE_REQUESTER_NAME,
          requesterInn: "0000000000",
          expiresAt: requestExpiresAt(now),
        })
      ),
    },
    {
      kind: "decision",
      letter: mark(
        requesterDecisionLetter({
          url,
          status: "approved",
          mode: "link",
          cabinetName: SAMPLE_CABINET_NAME,
          requesterName: SAMPLE_REQUESTER_NAME,
          allowedKinds: kinds,
          counters: { created: 12, updated: 3, skippedLimit: 0, skippedConflict: 1 },
        })
      ),
    },
  ];
}
