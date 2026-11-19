/**
 * Отказ обмена справочниками с текстом для человека и кодом ответа:
 * 403 — не владелец аккаунта, 404 — организация не из своего аккаунта,
 * 409 — организация закрыта или обмен уже идёт.
 */
export class DirectoryExchangeError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status = 400, code: string | null = null) {
    super(message);
    this.name = "DirectoryExchangeError";
    this.status = status;
    this.code = code;
  }
}
