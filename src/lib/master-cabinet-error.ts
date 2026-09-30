/** Понятная ошибка мастер-кабинета: текст показывается человеку, `status` — код ответа API. */
export class MasterCabinetError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}
