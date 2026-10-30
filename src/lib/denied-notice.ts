/**
 * Метка «сюда увели из закрытого раздела» (2026-10-29).
 *
 * Proxy не пускает линейного сотрудника в разделы руководства, а руководителя
 * точки — на страницы всей компании, и уводит на домашнюю. Раньше молча:
 * человек нажимал «Настройки» и оказывался в «Журналах», не понимая почему.
 * Теперь к адресу приземления добавляется `?denied=<откуда>`, страница один
 * раз объясняет, что раздел закрыт, и убирает метку из адреса.
 *
 * Модуль без React и Next — его читают proxy, клиент и тест.
 */

export const DENIED_PARAM = "denied";

/** Длиннее адреса страницы кабинета не бывает — остальное мусор или атака. */
const MAX_PATH_LENGTH = 200;

/**
 * Внутренний путь кабинета или `null`. Открытого редиректа быть не может:
 * метку только показывают, но и показывать чужой адрес незачем —
 * пропускаем лишь `/путь` без схемы, `//`, обратных слэшей и управляющих
 * символов; запрос и якорь отбрасываем.
 */
export function parseDeniedPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const path = value.split(/[?#]/)[0];
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (path.length > MAX_PATH_LENGTH) return null;
  if (/[\\\s\u0000-\u001f\u007f]/.test(path)) return null;
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return clean || null;
}

/**
 * Адрес приземления с меткой: `/journals` + `/settings/users` →
 * `/journals?denied=%2Fsettings%2Fusers`. Существующий запрос сохраняется,
 * прежняя метка заменяется. Плохой путь — адрес без метки.
 */
export function withDeniedParam(location: string, from: string): string {
  const denied = parseDeniedPath(from);
  const hashAt = location.indexOf("#");
  const hash = hashAt >= 0 ? location.slice(hashAt) : "";
  const withoutHash = hashAt >= 0 ? location.slice(0, hashAt) : location;
  const queryAt = withoutHash.indexOf("?");
  const path = queryAt >= 0 ? withoutHash.slice(0, queryAt) : withoutHash;
  const params = new URLSearchParams(queryAt >= 0 ? withoutHash.slice(queryAt + 1) : "");
  params.delete(DENIED_PARAM);
  if (denied) params.set(DENIED_PARAM, denied);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}${hash}`;
}

/**
 * Домашние адреса: уход с них к своей домашней — маршрут, а не отказ
 * (кнопки «На главную» ведут на `/dashboard`, у сотрудника дом — «Журналы»).
 */
const HOME_PATHS = new Set(["/", "/dashboard", "/home"]);

/**
 * Куда вести из закрытого раздела: адрес приземления proxy и метка,
 * если уход надо объяснить (не с домашних адресов и не с мусорного пути).
 */
export function deniedRedirectLocation(location: string, from: string): string {
  const path = parseDeniedPath(from);
  if (!path || HOME_PATHS.has(path)) return location;
  return withDeniedParam(location, path);
}

/**
 * Дальше — с той же меткой: домашние страницы сами уводят сотрудника по роли
 * («Журналы» → панель контроля или «Сегодня» приложения), и без этого
 * объяснение терялось бы на втором редиректе.
 */
export function keepDeniedParam(target: string, value: string | string[] | null | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && parseDeniedPath(raw) ? withDeniedParam(target, raw) : target;
}

/** Запрос без метки — для `history.replaceState` после показа: `?a=1&denied=…` → `?a=1`. */
export function stripDeniedParam(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (!params.has(DENIED_PARAM)) return search;
  params.delete(DENIED_PARAM);
  const query = params.toString();
  return query ? `?${query}` : "";
}
