import { parse } from "node-html-parser";
import { parseRubAmount } from "./gogetlinks-codec";
import { normalizeDomainName, type DonorCandidate } from "./gogetlinks-planner";

export function parseGglCatalogPage(markup: string): (DonorCandidate & { priceContextRub: number | null })[] {
  const root = parse(markup);
  const donors: (DonorCandidate & { priceContextRub: number | null })[] = [];
  for (const row of root.querySelectorAll("tr[id^='col_row_']")) {
    const siteId = Number((row.getAttribute("id") ?? "").slice("col_row_".length));
    const cells = new Map(row.querySelectorAll("td[data-th]").map(cell => [cell.getAttribute("data-th"), cell]));
    const domain = normalizeDomainName(cells.get("Сайт")?.querySelector("[data-favorite-domain]")
      ?.getAttribute("data-favorite-domain") ?? "");
    if (!domain || !Number.isSafeInteger(siteId) || siteId <= 0) continue;

    const flow = cells.get("Ссылочная мощь (TF/CF)")?.querySelector("[data-tooltip-body]")?.getAttribute("data-tooltip-body") ?? "";
    const tf = Number(flow.match(/Trust Flow\s*-\s*(\d+)/i)?.[1] ?? 0);
    const cf = Number(flow.match(/Citation Flow\s*-\s*(\d+)/i)?.[1] ?? 0);
    const indexation = Number.parseInt(cells.get("Индексация")?.text.trim() ?? "", 10);
    const price = (placement: string): number | null => {
      const input = cells.get(placement)?.querySelectorAll("input[type='hidden']")
        .find(field => new RegExp(`^h\\d+_${siteId}$`).test(field.getAttribute("id") ?? ""));
      const amount = parseRubAmount(input?.getAttribute("value") ?? "");
      return amount > 0 ? amount : null;
    };

    donors.push({
      siteId,
      domain,
      priceArticleRub: price("Статья"),
      priceNoteRub: price("Заметка"),
      priceContextRub: price("Контекстная"),
      tf,
      cf,
      trust: Number.parseInt(cells.get("Траст")?.text.trim() ?? "", 10) || 0,
      dailyTraffic: Number((cells.get("Трафик в сутки")?.text ?? "").replace(/\s/g, "")) || 0,
      indexedYandex: indexation > 0,
      indexedGoogle: indexation > 0,
    });
  }
  return donors;
}
