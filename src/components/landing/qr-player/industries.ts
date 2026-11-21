import type { ChapterId } from "./chapters";

/**
 * Вкладки вида деятельности над роликом QR (правки 20–21.11.2026). У каждого
 * вида свой ролик — набор глав того же движка: общепит — все шесть, у
 * медцентра и отеля — только подходящие сцены, без кухни (фритюра). Видео со
 * звуком и PDF подхватываются, когда файлы положат (`narrated-video.ts`).
 */
export const QR_INDUSTRIES = ["food", "medical", "hotel"] as const;
export type QrIndustry = (typeof QR_INDUSTRIES)[number];

export const DEFAULT_QR_INDUSTRY: QrIndustry = "food";

export const INDUSTRY_CHAPTERS: Record<QrIndustry, readonly ChapterId[]> = {
  food: ["fridge", "locker", "uv", "fryer", "forgot", "sensor"],
  // Медцентр: бактерицидная лампа, холодильник, напоминания. Раздевалки нет —
  // её запись идёт в гигиенический журнал общепита.
  medical: ["uv", "fridge", "forgot"],
  // Отель: допуск сотрудника перед сменой, холодильник, датчик, напоминания.
  hotel: ["locker", "fridge", "sensor", "forgot"],
};
