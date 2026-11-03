/**
 * Какие журналы каталога упоминает каждая статья блога.
 *
 * Зачем. Съём позиций 2026-09-10: из 53 информационных фраз статьи
 * ранжируются по двум, тогда как каталог держит 12 фраз в ТОП-3 и 25 в
 * ТОП-10. При этом единственная перелинковка в статье — блок «Похожие
 * статьи», то есть весь внутренний вес блога уходит на другие страницы
 * блога, которые сами не ранжируются. Каталог, который ранжируется, не
 * получает из блога ничего.
 *
 * Этот список разворачивает поток: из статьи ведут ссылки на конкретные
 * страницы журналов, о которых она и написана. Ссылка стоит по теме, а
 * не «для веса» — иначе это была бы накрутка, а не навигация.
 *
 * Коды сверяются с каталогом тестом: опечатка дала бы битую ссылку на
 * несуществующую страницу.
 */
export const BLOG_RELATED_JOURNALS: Record<string, readonly string[]> = {
  "vnutrennyaya-vs-vneshnyaya-dokumentatsiya-xaccp": [
    "audit_plan",
    "incoming_control",
    "traceability_test",
  ],
  "uxod-ot-formalnogo-ucheta": [
    "hygiene",
    "cold_equipment_control",
    "cleaning",
  ],
  "zhurnal-dezinfektsii": ["disinfectant_usage", "pest_control"],
  "zhurnal-temperatur-oborudovaniya": [
    "cold_equipment_control",
    "climate_control",
  ],
  "sinxronizatciya-iiko-1c": ["incoming_control", "product_writeoff"],
  "uchet-friturnyx-zhirov": ["fryer_oil"],
  "tri-vida-uborki": ["cleaning", "general_cleaning", "sanitary_day_control"],
  "zhurnal-otxodov": ["product_writeoff", "perishable_rejection"],
  "zhurnal-proslezhivaemosti": ["traceability_test", "incoming_control"],
  "xaccp-za-30-minut": [
    "finished_product",
    "incoming_control",
    "cold_equipment_control",
  ],
  "vnutrennij-audit-otchet": ["audit_report", "audit_protocol", "audit_plan"],
  "mojka-i-dezinfektsiya-oborudovaniya": [
    "equipment_cleaning",
    "disinfectant_usage",
  ],
  "uf-baktericidnyie-lampy": ["uv_lamp_runtime"],
  "proverka-rospotrebnadzora-chek-list": [
    "med_books",
    "hygiene",
    "cleaning",
    "disinfectant_usage",
  ],
  "sanpin-bez-byurokratii": [
    "hygiene",
    "health_check",
    "cleaning",
    "cold_equipment_control",
  ],
  "brakerazhnyi-zhurnal": ["finished_product", "perishable_rejection"],
  "obyazatelnyie-zhurnaly-dlya-obshchepita": [
    "hygiene",
    "health_check",
    "cold_equipment_control",
    "cleaning",
    "finished_product",
    "incoming_control",
  ],
  "temperatura-xolodilnikov-vitrin": [
    "cold_equipment_control",
    "climate_control",
  ],
  "sanpin-2026-chto-izmenilos": ["hygiene", "cleaning", "med_books"],
  "xaccp-dlya-restoratorov": [
    "finished_product",
    "incoming_control",
    "traceability_test",
  ],
  "elektronnyj-vs-bumazhnyj-zhurnal": ["hygiene", "cold_equipment_control"],
  "chek-list-priemki-syrya-v-restorane": [
    "incoming_control",
    "incoming_raw_materials_control",
    "perishable_rejection",
    "cold_equipment_control",
  ],
  "programma-proizvodstvennogo-kontrolya-obshchepit": [
    "hygiene",
    "cold_equipment_control",
    "finished_product",
    "audit_plan",
  ],
  "markirovka-produktov-i-zagotovok-na-kuhne": [
    "incoming_control",
    "inventory_condition",
    "cleaning",
    "product_writeoff",
  ],
  "usloviya-i-sroki-hraneniya-produktov-obshchepit": [
    "cold_equipment_control",
    "climate_control",
    "perishable_rejection",
  ],
  "obrabotka-yaic-i-sutochnye-proby-sanpin": [
    "daily_samples",
    "finished_product",
    "disinfectant_usage",
  ],
};

/** Не больше четырёх ссылок в блоке — дальше это перестаёт быть навигацией. */
export const MAX_RELATED_JOURNALS = 4;

export function relatedJournalCodes(slug: string): readonly string[] {
  return (BLOG_RELATED_JOURNALS[slug] ?? []).slice(0, MAX_RELATED_JOURNALS);
}
