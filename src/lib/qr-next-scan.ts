/**
 * «Следующий QR» (2026-09-23): после записи холодильника или склада камера
 * сканирует наклейку следующего объекта. Принимаем только полные ссылки
 * этого же сайта на наклейки холодильников (`/equipment-fill/<id>`) и
 * складов (`/room-fill/<id>`) с `token`. Всё остальное — не открываем:
 * чужие домены, плакаты журналов, `javascript:` и т.п. Следующий объект
 * открывается лишь его наклейкой перед камерой (решение 33d8559b).
 *
 * Возвращает путь с параметрами для `location.assign` или null.
 */
const OBJECT_PATH = /^\/(equipment-fill|room-fill)\/[^/]+$/;

export function parseNextQrTarget(text: string, origin: string): string | null {
  const raw = text.trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (!OBJECT_PATH.test(url.pathname)) return null;
  if (!url.searchParams.get("token")) return null;
  return `${url.pathname}${url.search}`;
}
