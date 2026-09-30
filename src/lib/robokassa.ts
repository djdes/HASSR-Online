import { createHash } from "crypto";

/**
 * Интеграция с Робокассой (iFrame-оплата, алгоритм подписи MD5).
 *
 * Три разных пароля с разным назначением — их легко перепутать, поэтому
 * здесь они инкапсулированы:
 *   • Пароль #1 — подпись исходящего запроса на оплату и проверка
 *     GET-возврата пользователя на SuccessURL;
 *   • Пароль #2 — проверка серверного уведомления на ResultURL;
 *   • Пароль #3 — XML/JWT-сервисы, в этом флоу не используется.
 *
 * В тестовом режиме (`ROBOKASSA_IS_TEST=1`) действуют отдельные тестовые
 * пароли, поэтому проверка подписи всегда смотрит на `isTest` конкретного
 * заказа, а не только на текущее значение env: иначе после активации
 * магазина «зависшие» тестовые заказы перестали бы верифицироваться.
 *
 * Документация: https://docs.robokassa.ru/ru/iframe
 */

const PAYMENT_URL = "https://auth.robokassa.ru/Merchant/Index.aspx";

export function isTestMode(): boolean {
  return (process.env.ROBOKASSA_IS_TEST ?? "").trim() === "1";
}

export function sendReceipt(): boolean {
  return (process.env.ROBOKASSA_SEND_RECEIPT ?? "").trim() === "1";
}

export function merchantLogin(): string {
  return (process.env.ROBOKASSA_MERCHANT_LOGIN ?? "").trim();
}

export function isConfigured(): boolean {
  return merchantLogin().length > 0 && password1(isTestMode()).length > 0;
}

function password1(test: boolean): string {
  const key = test ? "ROBOKASSA_TEST_PASSWORD1" : "ROBOKASSA_PASSWORD1";
  return (process.env[key] ?? "").trim();
}

function password2(test: boolean): string {
  const key = test ? "ROBOKASSA_TEST_PASSWORD2" : "ROBOKASSA_PASSWORD2";
  return (process.env[key] ?? "").trim();
}

function md5(value: string): string {
  return createHash("md5").update(value, "utf8").digest("hex");
}

/**
 * Сумма для подписи и для формы. Робокасса сверяет строку байт в байт,
 * поэтому формат строго с двумя знаками и точкой: «1990.00».
 */
export function formatOutSum(amountRub: number | string): string {
  return Number(amountRub).toFixed(2);
}

export type ReceiptItem = {
  name: string;
  quantity: number;
  sum: number;
  /**
   * Признак способа расчёта (54-ФЗ, тег 1214): full_payment — полный
   * расчёт (подписка); advance — аванс (пополнение баланса: предмет
   * расчёта в момент оплаты не определён).
   */
  payment_method: "full_payment" | "advance";
  /** Признак предмета расчёта (тег 1212): payment — «платёж» для аванса. */
  payment_object: "service" | "commodity" | "payment";
  tax: "none";
};

/**
 * Чек для фискализации. Робокасса требует, чтобы в подпись попадала
 * ровно та же urlencoded-строка, что уходит в параметре Receipt, —
 * поэтому кодируем один раз и переиспользуем результат.
 */
export function buildReceipt(items: ReceiptItem[]): {
  raw: string;
  encoded: string;
} {
  const raw = JSON.stringify({ items });
  return { raw, encoded: encodeURIComponent(raw) };
}

export type PaymentParams = {
  MerchantLogin: string;
  OutSum: string;
  InvId: string;
  Description: string;
  SignatureValue: string;
  Culture: string;
  Email?: string;
  Receipt?: string;
  IsTest?: string;
  /// «true» — первый платёж рекуррентной серии: Робокасса сохранит карту.
  Recurring?: string;
  /// Когда ссылка на оплату протухнет: «YYYY-MM-DDTHH:mm:ss.0000000+03:00».
  /// Ставим только заказам с холдом баллов, чтобы касса не приняла оплату
  /// после того, как баллы вернулись владельцу. В подпись не входит.
  ExpirationDate?: string;
};

/**
 * Параметры формы оплаты. Порядок в подписи фиксирован документацией:
 * `login:OutSum:InvId[:Receipt]:Password1`.
 */
export function buildPaymentParams(order: {
  id: number;
  amountRub: number | string;
  description: string;
  email: string;
  isTest: boolean;
  receiptItems?: ReceiptItem[];
  /// Человек согласился на автосписания — просим Робокассу запомнить
  /// карту. Без флага платёж разовый, и повторное списание невозможно.
  recurring?: boolean;
}): PaymentParams {
  const login = merchantLogin();
  const outSum = formatOutSum(order.amountRub);
  const invId = String(order.id);
  const receipt = order.receiptItems?.length
    ? buildReceipt(order.receiptItems)
    : null;

  const signatureBase = [
    login,
    outSum,
    invId,
    ...(receipt ? [receipt.encoded] : []),
    password1(order.isTest),
  ].join(":");

  const params: PaymentParams = {
    MerchantLogin: login,
    OutSum: outSum,
    InvId: invId,
    Description: order.description,
    SignatureValue: md5(signatureBase),
    Culture: "ru",
  };
  if (order.email) params.Email = order.email;
  if (receipt) params.Receipt = receipt.raw;
  if (order.isTest) params.IsTest = "1";
  // Подпись рекуррент не покрывает — Robokassa считает её по тем же
  // полям, поэтому флаг добавляем после вычисления SignatureValue.
  if (order.recurring) params.Recurring = "true";
  return params;
}

/** URL обычной (не iFrame) формы оплаты — фолбэк, если скрипт не загрузился. */
export function buildPaymentUrl(params: PaymentParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  return `${PAYMENT_URL}?${query.toString()}`;
}

function signaturesMatch(expected: string, received: string): boolean {
  return expected.toLowerCase() === received.trim().toLowerCase();
}

/**
 * Подпись серверного уведомления на ResultURL: `OutSum:InvId:Password2`.
 */
export function verifyResultSignature(args: {
  outSum: string;
  invId: string;
  signature: string;
  isTest: boolean;
  receipt?: string | null;
}): boolean {
  const base = [
    args.outSum,
    args.invId,
    ...(args.receipt ? [encodeURIComponent(args.receipt)] : []),
    password2(args.isTest),
  ].join(":");
  return signaturesMatch(md5(base), args.signature);
}

/**
 * Проверка подписи запроса оплаты (`login:OutSum:InvId[:Receipt]:Password1`).
 *
 * Используется как одноразовый «пропуск» к статусу заказа: страница
 * оформления получает эту подпись при создании заказа и опрашивает с ней
 * статус, пока клиент платит в iFrame. Подобрать её нельзя — она зависит
 * от Пароля #1, а знание номера заказа само по себе доступа не даёт.
 */
export function verifyPaymentRequestSignature(args: {
  outSum: string;
  invId: string;
  signature: string;
  isTest: boolean;
}): boolean {
  const base = [
    merchantLogin(),
    args.outSum,
    args.invId,
    password1(args.isTest),
  ].join(":");
  return signaturesMatch(md5(base), args.signature);
}

/**
 * Подпись возврата пользователя на SuccessURL: `OutSum:InvId:Password1`.
 * Используется, чтобы показать статус заказа только тому, кто реально
 * пришёл от Робокассы, — иначе чужой InvId раскрывал бы чужую оплату.
 */
export function verifySuccessSignature(args: {
  outSum: string;
  invId: string;
  signature: string;
  isTest: boolean;
}): boolean {
  const base = [args.outSum, args.invId, password1(args.isTest)].join(":");
  return signaturesMatch(md5(base), args.signature);
}
