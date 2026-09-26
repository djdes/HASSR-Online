/**
 * Ссылка из уведомления или из системы → путь внутри сайта.
 *
 * Общий модуль для сервера (`mobile-push.ts`, адрес в push) и браузера
 * (`native-bridge.ts`, нажатие на push и ссылки, которыми открыли
 * приложение). Поэтому здесь нет ни node-модулей, ни чтения
 * `process.env`: свои адреса стенда передаёт вызывающий код.
 */

const HOME = "/mini";

/** Боевой домен — свой всегда. */
const BASE_OWN_HOSTS = ["wesetup.ru", "www.wesetup.ru"];

/** Хосты из списка адресов (`host[:port]` в нижнем регистре); битые и пустые пропускаем. */
export function hostsFromUrls(urls: ReadonlyArray<string | null | undefined>): string[] {
  const hosts: string[] = [];
  for (const raw of urls) {
    if (!raw) continue;
    try {
      hosts.push(new URL(raw).host.toLowerCase());
    } catch {
      /* битый адрес — просто не считаем его своим */
    }
  }
  return hosts;
}

/**
 * Абсолютный адрес своего домена превращаем в путь; чужой домен,
 * `//host`, `javascript:`, обработчики `/api/*` и прочее непонятное
 * ведём на главный экран `/mini` — оттуда сайт сам разведёт человека по
 * правам. Экран, куда у человека нет прав, тоже разруливает сайт (он
 * уводит на главный), а не приложение.
 */
export function normalizePushUrl(
  href: string | null | undefined,
  extraHosts: ReadonlyArray<string> = []
): string {
  if (!href) return HOME;
  let path = href.trim();
  if (!path) return HOME;
  if (/^https?:\/\//i.test(path)) {
    let url: URL;
    try {
      url = new URL(path);
    } catch {
      return HOME;
    }
    const own = new Set([...BASE_OWN_HOSTS, ...extraHosts.map((host) => host.toLowerCase())]);
    if (!own.has(url.host.toLowerCase())) return HOME;
    path = `${url.pathname}${url.search}${url.hash}`;
  }
  // Управляющие символы и обратный слэш: `/\evil.example` браузер
  // понимает как `//evil.example`.
  if (/[\u0000-\u001f\\]/.test(path)) return HOME;
  if (!path.startsWith("/") || path.startsWith("//")) return HOME;
  const pathname = path.split(/[?#]/)[0];
  if (pathname === "/api" || pathname.startsWith("/api/")) return HOME;
  return path;
}
