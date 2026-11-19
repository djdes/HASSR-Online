/**
 * Canonical SEO, PF (vtop.online), Wordstat, and Topvisor priority brief shared
 * with the GoGetLinks webmaster analysis dispatcher (`wesetup_ggl_webmasters`).
 *
 * Keep synchronized with `docs/seo/current-state.md`.
 */
export const GGL_SEO_CURRENT_STRATEGY_UPDATED_AT = "2026-11-19";

export const GGL_WEBMASTER_CURRENT_SEO_BRIEF = [
  `Актуальный SEO/ПФ-контекст wesetup.ru (срез ${GGL_SEO_CURRENT_STRATEGY_UPDATED_AT}, подробности в docs/seo/current-state.md):`,
  "1) Сейчас в ПФ (втоп.online) переключены на 6 коротких ВЧ-запросов: /journals-info/incoming_control («журнал входного контроля», ~13k — в выдаче мешает строительный ГОСТ, критически нужен траст пищевых/бизнес/правовых СМИ и B2B), /journals-info/health_check («журнал здоровья», 11 749, #26 Мск), /journals-info/climate_control («журнал температуры», ~10k, #9 ПФ / #18 Мск — дожим в ТОП-1–3), /journals-info/uv_lamp_runtime («бактерицидный журнал», 7 389 — подходят медицина, клиники, HoReCa, образование, салоны, СМИ), /journals-info/general_cleaning («журнал генеральных уборок», 5 846 / «график генеральной уборки», 3 488, #9 РФ — HoReCa, клининг, бизнес/СМИ), /journals-info/disinfectant_usage («журнал дезинфекции», 4 145 — HoReCa, медицина, клининг, дезинфекция).",
  "2) Дополнительные приоритетные 200 OK цели для ссылок: /zhurnal-haccp («журналы хассп», 2 275 — трафик делят / и /blanki), / (общий траст домена), /journals-info/product_writeoff («журнал списания», 2 356 — #5–7 по хвосту, общепит/ритейл/iiko/1С), /journals-info/finished_product («бракеражный журнал» уже #1 в ПФ, нужны точечные трастовые ссылки для удержания органики), /dlya-fastfuda, /dlya-otelya, /dlya-kafe, /sanpin-2-3-2-4-4282-26.",
  "3) Уже в ТОП-1 (не тратить бюджет в первую очередь): /journals-info/hygiene, /journals-info/cleaning, /journals-info/cold_equipment_control.",
  "4) Строгие запреты: НЕ предлагать ссылки на 301-слитые старые слаги (/zhurnal-vhodnogo-kontrolya, /brakerazhnyy-zhurnal, /zhurnal-temperatury-i-vlazhnosti, /zhurnal-generalnyh-uborok, /zhurnal-zdorovya, /elektronnyy-zhurnal-sanpin, /haccp-dlya-kafe), на /blanki (каннибализирует выдачу) и на закрытый кабинет (/journals, /sanpin, /orders, /dashboard).",
  "5) Для площадок со статусом recommended и consider в поле reason кратко указывай, под какую из приоритетных тем/URL выше донор подходит лучше всего по тематике и аудитории.",
].join(" ");
