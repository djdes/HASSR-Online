/**
 * Промо TasksFlow.ru в интерфейсе Wesetup.
 *
 * Держим промокод и сборку ссылки в одном месте, потому что блок
 * показывается сразу в нескольких точках входа (форма добавления
 * сотрудника, модалка завершения регистрации, настройки интеграции,
 * Mini App). Если маркетинг поменяет код или формат параметра —
 * правится только этот файл, а не пять компонентов.
 *
 * Формат параметра промокода (`?promo=`) — договорённость с TasksFlow;
 * если там промокод вводится при регистрации, меняется только
 * `TASKSFLOW_PROMO_PATH` ниже.
 */

export const TASKSFLOW_PROMO_CODE = "WESETUP50";

/** Человекочитаемая выгода — используется в текстах промо-блока. */
export const TASKSFLOW_PROMO_BENEFIT = "−50 % на первый месяц";

const TASKSFLOW_PROMO_ORIGIN = "https://tasksflow.ru";

/**
 * Сайт сервиса задач. В интерфейсе он называется «Программный модуль»
 * (владелец, 2026-11-23), а ссылка ведёт сюда — что это за сервис.
 */
export const TASKSFLOW_SITE_URL = TASKSFLOW_PROMO_ORIGIN;
const TASKSFLOW_PROMO_PATH = "/";

/**
 * Ссылка на TasksFlow с промокодом и UTM-метками.
 * `campaign` — точка входа (`staff_add`, `register_nudge`, ...), чтобы
 * в аналитике TasksFlow было видно, какой экран Wesetup приводит людей.
 */
export function tasksflowPromoUrl(campaign: string): string {
  const params = new URLSearchParams({
    promo: TASKSFLOW_PROMO_CODE,
    utm_source: "wesetup",
    utm_medium: "app",
    utm_campaign: campaign,
  });
  return `${TASKSFLOW_PROMO_ORIGIN}${TASKSFLOW_PROMO_PATH}?${params.toString()}`;
}
