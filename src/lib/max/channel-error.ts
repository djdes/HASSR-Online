/** Понятная ошибка публикации в канал: текст сразу показывается в админке. */
export class MaxChannelError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
