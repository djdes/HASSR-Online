# Spec — seo-speed-pack-2026-11 (frozen 2026-11-17)

Запрос владельца: «Сделай все кроме 4, в 12 особенно перепроверь во всех лендингах по сайту и оставь только один запрос чтобы не спорили… Мердж и в прод, после чего ещё проверь что можно улучшить что даст отклики».
Пункты — из 20 предложений аудита 2026-11-17 (кроме 4 — Brotli).

## Карта запросов (п. 12): один запрос — одна страница
Обход всех 244 русских URL из sitemap прода (title/H1/description). Решения:

301 (слияние дублей; страница-победитель — справа):
- /zhurnal-uborki → /journals-info/cleaning
- /zhurnal-generalnyh-uborok → /journals-info/general_cleaning
- /brakerazhnyy-zhurnal → /journals-info/finished_product
- /temperaturnyy-list-holodilnika → /journals-info/cold_equipment_control
- /zhurnal-temperatury-i-vlazhnosti → /journals-info/climate_control
- /zhurnal-vhodnogo-kontrolya → /journals-info/incoming_control
- /zhurnal-frityurnyh-zhirov → /journals-info/fryer_oil
- /zhurnal-medknizhek → /journals-info/med_books
- /zhurnal-sutochnyh-prob → /journals-info/daily_samples
- /zhurnal-zdorovya → /journals-info/health_check
- /haccp-dlya-kafe → /dlya-kafe
- /elektronnyy-zhurnal-sanpin → /
- /glossary/gigienicheskiy-zhurnal → /journals-info/hygiene
- /glossary/zhurnal-zdorovya → /journals-info/health_check
- /glossary/sanpin-2-3-2-4-4282-26 → /sanpin-2-3-2-4-4282-26
- /glossary/programma-proizvodstvennogo-kontrolya → /blog/programma-proizvodstvennogo-kontrolya-…

Переименование (разные запросы вместо одного): каталог /journals-info, /features, /calc/journals, /zhurnal-haccp (→ коммерческая «журнал ХАССП», п. 15), пары incoming_control / incoming_raw_materials_control, glass_items_list / glass_control, glossary/stekloreglament, /features/autofill vs /avtozapolnenie, title журналов-победителей (+ «бланк и образец»), статьи блога, которые начинались с названия журнала (бракераж, температура, фритюр, уборка, дезинфекция, УФ, мойка оборудования, внутренний аудит, электронный vs бумажный, iiko/1С, ХАССП для ресторана/кафе, яйца/суточные пробы), KB «Программа производственного контроля».
Все внутренние ссылки, меню, sitemap, поиск по сайту, планировщик ссылок — на страницы-победители.

## Критерии приёмки
- AC1 (п.12): редиректы 301 выше работают; в sitemap и меню нет перенаправленных адресов; у каждой оставшейся пары — разный главный запрос в title/H1; тест на уникальность title по публичным страницам.
- AC2 (п.1, 6): главная на телефоне — фон первого экрана легче (≤ 70 КБ) и без preload большой картинки на телефоне; CLS первого экрана < 0,1.
- AC3 (п.2): статика `/landing/*` (и прочие картинки из public без хеша) — кеш браузера ≥ 7 дней.
- AC4 (п.3): тяжёлые клиентские виджеты публичных страниц (поиск-диалог, чат поддержки, контакты, конструктор) грузятся лениво; JS страницы журнала меньше, чем до правки (замер).
- AC5 (п.5): ответ сервера публичных страниц ускорен (кеш данных/рендера) — замер TTFB до/после локально.
- AC6 (п.7–11): Clean-param ysclid; title ≤ 60 и description 70–160 у страниц журналов; lastmod в sitemap — реальные даты, не время сборки; картинки превью бланков в sitemap (image) + ImageObject + robots разрешает превью; разметка на /baza-znaniy и Organization с sameAs.
- AC7 (п.13): страницы ниш — блок «Журналы для <ниши>» со ссылками на страницы журналов (с образцами).
- AC8 (п.14): дополнительные вопросы FAQ по каждому журналу (3–4, под реальные формулировки запросов) на ru/en/uz, в FAQPage.
- AC9 (п.15): /zhurnal-haccp — коммерческая страница «электронный журнал ХАССП»: сравнение с бумагой, цены, CTA, без конкуренции с главной.
- AC10 (п.16): Word-бланк для каждого журнала (у кого не было — универсальный по колонкам образца).
- AC11 (п.17): дата обновления и автор (редакция WeSetup) на страницах журналов + dateModified/author в Article.
- AC12 (п.18): калькуляторы встраиваются iframe-кодом с обратной ссылкой.
- AC13 (п.19): AggregateRating в разметке при наличии одобренных отзывов с оценкой (сейчас 0 — разметки нет).
- AC14 (п.20): после скачивания бланка — «Вам также пригодятся» 3 связанных журнала.
- AC15: typecheck, тесты (полный прогон в CI, т.к. >25 файлов), e2e; мердж в master и проверка деплоя; затем анализ «что даст больше откликов» — отчёт.
