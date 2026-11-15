/**
 * Пакет документов клиенту: тексты письма по умолчанию (чистые функции — их
 * же показывает окно отправки и проверяют тесты).
 */
export const PACKAGE_DOC_KINDS = ["contract", "invoice", "requisites"] as const;
export type PackageDocKind = (typeof PACKAGE_DOC_KINDS)[number];

export function defaultPackageSubject(companyName: string): string {
  return companyName ? `Документы WeSetup для ${companyName}` : "Документы WeSetup";
}

const rub = (value: number) => `${value.toLocaleString("ru-RU").replace(/ | /g, " ")} ₽`;
const ruDate = (iso: string) => iso.split("-").reverse().join(".");

export type PackageMessageInput = {
  companyName: string;
  docs: readonly PackageDocKind[];
  contract: { number: string; date: string } | null;
  invoice: { id: number; amountRub: number } | null;
};

/** Короткое письмо в нашем стиле: что во вложении и что делать дальше. */
export function defaultPackageMessage(params: PackageMessageInput): string {
  const items: string[] = [];
  if (params.docs.includes("contract") && params.contract) items.push(`— договор № ${params.contract.number} от ${ruDate(params.contract.date)};`);
  if (params.docs.includes("invoice") && params.invoice) items.push(`— счёт № ${params.invoice.id} на ${rub(params.invoice.amountRub)} — в нём QR-код для оплаты из приложения банка;`);
  if (params.docs.includes("requisites")) items.push("— карточка организации ООО «БФС» с реквизитами;");
  if (items.length) items[items.length - 1] = items[items.length - 1].replace(/;$/, ".");
  const next: string[] = [];
  if (params.docs.includes("contract") && params.contract) next.push("Подпишите договор и пришлите скан ответным письмом — оригиналы обменяем по почте или через ЭДО.");
  if (params.docs.includes("invoice") && params.invoice) next.push("После оплаты доступ откроется автоматически, закрывающие документы появятся в кабинете.");
  return [
    "Здравствуйте!",
    `Как и просили, направляем документы${params.companyName ? ` для ${params.companyName}` : ""} — они во вложении (PDF):\n${items.join("\n")}`,
    ...(next.length ? [next.join(" ")] : []),
    "Если нужно что-то поправить или прислать в другом виде — просто ответьте на это письмо.",
  ].join("\n\n");
}

/** Список вложений под письмом — как у КП и счёта, только списком. */
export function packageAttachmentList(fileNames: readonly string[]): string {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const items = fileNames.map((name) => `<li style="margin:2px 0">${escape(name)}</li>`).join("");
  return `<p style="margin:18px 0 4px;font-size:13px;color:#6f7282">Во вложении:</p><ul style="margin:0;padding-left:18px;font-size:13px;color:#6f7282">${items}</ul>`;
}
