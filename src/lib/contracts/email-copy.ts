import { contractDateShort } from "./format";

/**
 * Тема и текст письма с договором по умолчанию. Чистый модуль: карточка
 * ROOT подставляет их в форму, сервер — если поле оставили пустым. Письмо
 * клиенту — на русском, как и сам договор.
 */

export function defaultContractSubject(number: string): string {
  return `Договор оказания услуг № ${number} — WeSetup`;
}

export function defaultContractMessage(params: { buyerName: string; number: string; date: string; sellerEmail: string }): string {
  return [
    "Здравствуйте!",
    `Направляем договор оказания услуг № ${params.number} от ${contractDateShort(params.date)} между ООО «БФС» (сервис WeSetup) и ${params.buyerName}. Реквизиты обеих сторон уже заполнены — договор во вложении (PDF).`,
    `Проверьте, пожалуйста, данные, подпишите договор и пришлите скан в ответ на это письмо${params.sellerEmail ? ` или на ${params.sellerEmail}` : ""}. Если удобнее подписать по ЭДО (Сбис, Контур.Диадок), напишите — отправим приглашение.`,
  ].join("\n\n");
}
