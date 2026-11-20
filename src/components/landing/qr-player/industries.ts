/**
 * Вкладки вида деятельности над роликом QR (правки 20.11.2026). Ролик со
 * сценой и главами снят для общепита; у медцентра и отеля пока плашка
 * «в разработке», их видео и PDF подхватываются, когда файлы положат
 * (`narrated-video.ts`).
 */
export const QR_INDUSTRIES = ["food", "medical", "hotel"] as const;
export type QrIndustry = (typeof QR_INDUSTRIES)[number];

export const DEFAULT_QR_INDUSTRY: QrIndustry = "food";

/** Вид, у которого есть интерактивный ролик (сцена Remotion и главы). */
export const INTERACTIVE_QR_INDUSTRY: QrIndustry = "food";
