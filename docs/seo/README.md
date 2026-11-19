# База знаний SEO, ПФ, Topvisor и GoGetLinks (`wesetup.ru`)

Эта папка — **единая точка правды для всех ИИ-агентов** по поисковому продвижению `wesetup.ru`.

## Обязательный порядок работы для любого агента при SEO-запросе

1. **Сначала прочитай актуальное состояние:**
   - [`current-state.md`](./current-state.md) — живой срез ПФ (`втоп.online/projects/180937`), проверенные частотности Яндекс.Вордстат, текущие позиции и регионы Topvisor (`32866188`), 301-редиректы, проблемы каннибализации и приоритетные URL для закупки ссылок в GoGetLinks (`#884931`).
   - [`gogetlinks-and-pf-reglament.md`](./gogetlinks-and-pf-reglament.md) — базовый регламент (эталон `yesbeat.ru`, 50/30/20 по анкорам, структура готовых статей, правила отбора доноров).
   - [`../../src/content/seo-redirects.ts`](../../src/content/seo-redirects.ts) — актуальная карта 301-слияний (запрещено покупать ссылки или вести ПФ на старые 301-адреса).
2. **Если меняются приоритеты, ключи ПФ или канонические URL:**
   - Обнови [`current-state.md`](./current-state.md).
   - Синхронизируй константу [`GGL_SEO_CURRENT_STRATEGY`](../../src/lib/seo/seo-current-strategy.ts) — она автоматически передаётся в промпт диспетчера анализа вебмастеров GoGetLinks (`wesetup_ggl_webmasters` в [`gogetlinks-applications.server.ts`](../../src/lib/seo/gogetlinks-applications.server.ts)).
3. **После любого SEO-аудита, проверки Вордстата или разбора Topvisor:**
   - Фиксируй новые цифры, снятые ключи, отсечённые пустышки и сдвиги позиций в [`current-state.md`](./current-state.md) (или в новом файле в `docs/seo/` со ссылкой из этого `README.md`), чтобы следующий агент не повторял уже проделанную работу.

## Инструменты и идентификаторы проекта

- **Topvisor**: проект **`32866188`** (`Журналы`, `wesetup.ru`), `User-Id: 299034`. Админка: `/root/seo/positions`.
- **ПФ (`втоп.online`)**: проект **`180937`** (`Wesetup`), лимит `24 клика в сутки` (6 коротких ВЧ-ключей × 4 клика/сут).
- **GoGetLinks**: кампания **`#884931`** (`WeSetup электронные журналы ХАССП`). Админка: `/root/seo/links`.
- **AI-диспетчер анализа вебмастеров**: тип задания `wesetup_ggl_webmasters` ([`gogetlinks-applications.server.ts`](../../src/lib/seo/gogetlinks-applications.server.ts), стратегия из [`seo-current-strategy.ts`](../../src/lib/seo/seo-current-strategy.ts)).
