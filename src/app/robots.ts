import type { MetadataRoute } from "next";

/**
 * Полный список private routes из (dashboard) — все они auth-redirect'ят
 * на /login (307), но явный disallow:
 *   1. экономит crawl budget Google (он не дёргает страницы только чтобы
 *      получить редирект)
 *   2. защищает от случайной индексации title/description если кто-то
 *      шарит deep-link
 *   3. документирует приватный периметр для security-аудита
 *
 * Не используем `/journals` (без слэша) потому что prefix-match съест
 * публичные `/journals-info` и `/journals-progress` (последний — тоже
 * private, но листим отдельно для ясности).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          // API и admin корни
          "/api/",
          "/root/",
          "/admin/",
          // Корневой dashboard
          "/dashboard",
          // Журналы dashboard (НЕ /journals-info — это публичный каталог)
          "/journals/",
          "/journals-progress",
          // Настройки + invite-token wizard
          "/settings",
          // Кабинет партнёра и брендированные страницы входа партнёров
          // (/partners — публичная страница программы — остаётся открытой,
          // поэтому без "$" нельзя: Disallow работает по префиксу)
          "/partner/",
          "/partner$",
          "/p/",
          // Все остальные dashboard routes
          "/batches",
          "/bonuses",
          "/capa",
          "/changes",
          "/competencies",
          "/control-board",
          "/losses",
          "/plans",
          "/reports",
          "/sanpin",
          "/staff",
          "/team",
          "/verifications",
          "/verify",
          // Mini App — robots уже стоит index:false в layout, но добавим
          // и сюда для defense-in-depth.
          "/mini",
          // Auth flow и invite-token
          "/invite/",
          // Токен-страницы (гость-инспектор, приглашение сотрудника) —
          // доступ по расшаренной ссылке, в индексе им делать нечего.
          "/inspector/",
          "/join/",
          // Task fill через QR-код (одноразовые ссылки, незачем в индексе)
          "/task-fill",
          "/equipment-fill",
          // Замер по QR-плакату помещения (подписанная ссылка)
          "/room-fill",
          // Запись в журнал по QR-плакату (подписанная ссылка)
          "/journal-fill",
        ],
      },
    ],
    sitemap: "https://wesetup.ru/sitemap.xml",
    host: "https://wesetup.ru",
  };
}
