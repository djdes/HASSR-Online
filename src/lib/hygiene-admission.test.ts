import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMISSION_NEEDS_HEALTH_ANSWER_MESSAGE,
  canAdmitEmployee,
  hasHealthAnswer,
  hygieneAdmissionWriteError,
  isHygieneEntryCopyable,
} from "./hygiene-admission";
import { healthDecision } from "./health-qr";
import { applyHygieneVerification } from "./hygiene-v2";

/**
 * Пожелание РПН (2026-09-24): заведующий производством не может поставить
 * «Допущен», пока сотрудник не ответил хотя бы на один вопрос о здоровье
 * за этот день. «Отстранён» — всегда.
 */

const declared = { ...healthDecision(["temperature", "infection", "respiratorySkin"]).hygiene, confirmations: { temperature: true, infection: true, respiratorySkin: true }, source: "qr", confirmedAt: "08:05" };
const complained = { status: "suspended", confirmations: { temperature: false, infection: true, respiratorySkin: true }, source: "qr", confirmedAt: "08:06" };
const verification = { result: "admitted" as const, byUserId: "boss", byName: "Иванова", byTitle: "Зав. производством", at: "08:10", method: "qr" as const };

test("ответ сотрудника — подписи за день (QR / TasksFlow)", () => {
  assert.equal(hasHealthAnswer(declared), true);
  assert.equal(hasHealthAnswer(complained), true);
  // Хотя бы на один вопрос.
  assert.equal(hasHealthAnswer({ confirmations: { temperature: true } }), true);
  // Прежняя форма QR (пять пунктов) — тоже ответ.
  assert.equal(hasHealthAnswer({ status: "healthy", confirmations: { intestinal: true } }), true);
});

test("не ответ: пусто, заготовка строки, статус за сотрудника", () => {
  assert.equal(hasHealthAnswer(null), false);
  assert.equal(hasHealthAnswer({}), false);
  assert.equal(hasHealthAnswer({ _autoSeeded: true, confirmations: { temperature: true } }), false);
  assert.equal(hasHealthAnswer({ status: "healthy", temperatureAbove37: false }), false);
  assert.equal(hasHealthAnswer({ status: "day_off" }), false);
  assert.equal(hasHealthAnswer({ confirmations: {} }), false);
  assert.equal(hasHealthAnswer({ confirmations: { temperature: "yes" } }), false);
  assert.equal(hasHealthAnswer({ confirmations: [true] }), false);
});

test("canAdmitEmployee: «Допущен» только с ответом, «Отстранён» всегда", () => {
  assert.deepEqual(canAdmitEmployee({ result: "admitted", entry: declared }), { ok: true });
  assert.deepEqual(canAdmitEmployee({ result: "admitted", entry: complained }), { ok: true });
  assert.deepEqual(canAdmitEmployee({ result: "admitted", entry: null }), {
    ok: false,
    error: ADMISSION_NEEDS_HEALTH_ANSWER_MESSAGE,
  });
  assert.deepEqual(canAdmitEmployee({ result: "admitted", entry: { status: "healthy" } }), {
    ok: false,
    error: ADMISSION_NEEDS_HEALTH_ANSWER_MESSAGE,
  });
  assert.deepEqual(canAdmitEmployee({ result: "suspended", entry: null }), { ok: true });
  assert.equal(ADMISSION_NEEDS_HEALTH_ANSWER_MESSAGE, "Сотрудник ещё не ответил на вопросы о здоровье");
});

test("запись через API: допуск без ответа в базе — отказ", () => {
  const admitted = applyHygieneVerification({}, verification);
  assert.equal(hygieneAdmissionWriteError({ formVersion: 2, previous: null, next: admitted }), ADMISSION_NEEDS_HEALTH_ANSWER_MESSAGE);
  assert.equal(hygieneAdmissionWriteError({ formVersion: 1, previous: null, next: admitted }), ADMISSION_NEEDS_HEALTH_ANSWER_MESSAGE);
  // Подписи, присланные вместе с допуском, не в счёт — смотрим в базу.
  const forged = applyHygieneVerification({ confirmations: { temperature: true } }, verification);
  assert.equal(
    hygieneAdmissionWriteError({ formVersion: 2, previous: { _autoSeeded: true }, next: forged }),
    ADMISSION_NEEDS_HEALTH_ANSWER_MESSAGE
  );
  // Новая форма: «Здоров» руками — тоже допуск.
  assert.equal(
    hygieneAdmissionWriteError({ formVersion: 2, previous: null, next: { status: "healthy" } }),
    ADMISSION_NEEDS_HEALTH_ANSWER_MESSAGE
  );
});

test("запись через API: с ответом, отстранение и прочие правки — как раньше", () => {
  const admitted = applyHygieneVerification(declared, verification);
  assert.equal(hygieneAdmissionWriteError({ formVersion: 2, previous: declared, next: admitted }), null);
  // Уже допущен — правка других полей записи не требует ответа заново.
  assert.equal(hygieneAdmissionWriteError({ formVersion: 2, previous: admitted, next: { ...admitted, note: "x" } }), null);
  // Отстранить можно без ответа.
  const suspended = applyHygieneVerification({}, { ...verification, result: "suspended" });
  assert.equal(hygieneAdmissionWriteError({ formVersion: 2, previous: null, next: suspended }), null);
  // Выходной / больничный / отпуск — всегда.
  assert.equal(hygieneAdmissionWriteError({ formVersion: 2, previous: null, next: { status: "sick_leave" } }), null);
  // Старая форма: «Здоров» в ячейке без допуска — прежнее поведение.
  assert.equal(hygieneAdmissionWriteError({ formVersion: 1, previous: null, next: { status: "healthy", temperatureAbove37: false } }), null);
  assert.equal(hygieneAdmissionWriteError({ formVersion: 2, previous: null, next: null }), null);
});

test("перенос на другой день: подписи и допуск не переносятся", () => {
  assert.equal(isHygieneEntryCopyable(applyHygieneVerification(declared, verification), 1), false);
  assert.equal(isHygieneEntryCopyable(declared, 1), false);
  assert.equal(isHygieneEntryCopyable({ status: "healthy", temperatureAbove37: false }, 1), true);
  assert.equal(isHygieneEntryCopyable({ status: "day_off" }, 2), true);
  assert.equal(isHygieneEntryCopyable({ status: "healthy" }, 2), false);
  assert.equal(isHygieneEntryCopyable(null, 1), false);
});
