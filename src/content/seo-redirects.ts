/**
 * Один запрос — одна страница (спека seo-speed-pack-2026-11, п. 12).
 *
 * Обход всех публичных страниц 2026-11-17 показал пары, которые спорили за
 * один запрос: посадочная «/zhurnal-…» и страница журнала в каталоге с тем же
 * названием, термин глоссария с названием журнала, второй лендинг «ХАССП для
 * кафе». Дубли сливаем постоянным редиректом 301 в более полную страницу:
 * ссылочный вес и закладки переезжают, поисковик видит одну страницу.
 *
 * Новый лендинг под запрос, у которого уже есть страница, не заводить —
 * сначала проверить этот список и `seo-query-map.test.ts`.
 */
export const SEO_REDIRECTS: Readonly<Record<string, string>> = {
  "/zhurnal-uborki": "/journals-info/cleaning",
  "/zhurnal-generalnyh-uborok": "/journals-info/general_cleaning",
  "/brakerazhnyy-zhurnal": "/journals-info/finished_product",
  "/temperaturnyy-list-holodilnika": "/journals-info/cold_equipment_control",
  "/zhurnal-temperatury-i-vlazhnosti": "/journals-info/climate_control",
  "/zhurnal-vhodnogo-kontrolya": "/journals-info/incoming_control",
  "/zhurnal-frityurnyh-zhirov": "/journals-info/fryer_oil",
  "/zhurnal-medknizhek": "/journals-info/med_books",
  "/zhurnal-sutochnyh-prob": "/journals-info/daily_samples",
  "/zhurnal-zdorovya": "/journals-info/health_check",
  "/haccp-dlya-kafe": "/dlya-kafe",
  "/elektronnyy-zhurnal-sanpin": "/",
  "/glossary/gigienicheskiy-zhurnal": "/journals-info/hygiene",
  "/glossary/zhurnal-zdorovya": "/journals-info/health_check",
  "/glossary/sanpin-2-3-2-4-4282-26": "/sanpin-2-3-2-4-4282-26",
  "/glossary/programma-proizvodstvennogo-kontrolya": "/blog/programma-proizvodstvennogo-kontrolya-obshchepit",
};

/** Куда ведёт адрес после слияния дублей; `null` — страница живая. */
export function seoRedirectTarget(pathname: string): string | null {
  return Object.hasOwn(SEO_REDIRECTS, pathname) ? SEO_REDIRECTS[pathname] : null;
}
