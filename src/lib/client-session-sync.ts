import type { Session } from "next-auth";

/**
 * Клиентская сессия догоняет серверную (владелец, 2026-11-12).
 *
 * `SessionProvider` next-auth v4 берёт `session` из пропса только при первом
 * рендере. Смена организации перевыпускает куку, layout после
 * `router.refresh()` получает новую сессию, а `useSession()` до перезагрузки
 * отдавал прежние организацию, роль и права: настройки журналов прежней
 * организации, проверки прав в клиенте, профиль мини-приложения.
 *
 * Сравниваем «подпись» сессии (всё, что про человека и организацию, без срока
 * жизни) и, когда сервер прислал новую, а клиент отстал, просим провайдер
 * перечитать сессию — событием `storage`, как `adoptCookieSession` в
 * мини-приложении. Так нет состояния «загрузка» (у `update()` оно есть, и
 * профиль мини-приложения мигал бы скелетом) и нет записи в токен.
 */
export function sessionSignature(session: Session | null | undefined): string {
  return session?.user ? JSON.stringify(session.user) : "";
}

/**
 * Перечитывать, только если сессия пришла с сервера заново (`previousServer`
 * ≠ `server`) и клиент с ней не совпадает. Сессии на сервере нет (выход) —
 * не трогаем: выходом занимается сам выход. Клиент разошёлся с прежним
 * пропсом сам (вход в мини-приложении на клиенте) — тоже не трогаем.
 */
export function needsClientSessionReread(state: { previousServer: string; server: string; client: string }): boolean {
  if (!state.server || state.server === state.previousServer) return false;
  return state.client !== state.server;
}

/**
 * Попросить `SessionProvider` этой вкладки перечитать сессию: next-auth
 * слушает `storage` с ключом `nextauth.message` (сообщения соседних вкладок),
 * браузер шлёт его только другим вкладкам — отправляем себе сами.
 */
export function rereadClientSession(): void {
  try {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "nextauth.message",
        newValue: JSON.stringify({
          event: "session",
          data: { trigger: "getSession" },
          timestamp: Math.floor(Date.now() / 1000),
        }),
      }),
    );
  } catch {
    /* нет StorageEvent — сессия догонит после перезагрузки */
  }
}
