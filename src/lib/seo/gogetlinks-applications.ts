import { parse } from "node-html-parser";

export interface GglApplication {
  id: string;
  campaignId: number;
  siteId: number;
  domain: string;
  siteUrl: string;
  placementType: string;
  priceRub: number | null;
  dailyTraffic: number | null;
  tf: number | null;
  cf: number | null;
  iks: number | null;
  trust: number | null;
  badges: string[];
}

export interface GglSiteCard {
  siteId: number;
  domain: string;
  fetchedAt: string;
  fields: { group: string; label: string; value: string }[];
  examples: string[];
}

export interface GglApplicationsSnapshot {
  version: 1;
  campaignId: number;
  fetchedAt: string;
  sourceTotal: number;
  complete: boolean;
  warning: string | null;
  applications: GglApplication[];
}

export interface GglSiteCardResult {
  siteId: number;
  card: GglSiteCard | null;
  error: string | null;
  attemptedAt: string;
}

export interface GglWebmasterAnalysis {
  snapshotId: string;
  createdAt: string;
  consideredSiteIds: number[];
  summary: string;
  limitations: string[];
  recommendations: {
    siteId: number;
    verdict: "recommended" | "consider" | "avoid";
    reason: string;
  }[];
}

export interface GglApplicationsView {
  campaignId: number;
  campaignName: string;
  snapshotId: string;
  snapshot: GglApplicationsSnapshot;
  cards: GglSiteCardResult[];
  analysis: GglWebmasterAnalysis | null;
}

const text = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();
export function gglMetric(value?: string | null): number | null {
  const normalized = text(value).replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function safeGglSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function parseGglApplicationsPage(html: string, campaignId: number) {
  const root = parse(html);
  const totalMatch = /ReviewsRequestData\.countAll\s*=\s*(\d+)/.exec(html);
  const pageMatch = /ReviewsRequestData\.pageNum\s*=\s*(\d+)/.exec(html);
  if (!totalMatch || !pageMatch) throw new Error("GoGetLinks не вернул счётчик или номер страницы заявок");
  const total = Number(totalMatch[1]);
  const rawPage = Number(pageMatch[1]);
  const currentSpan = Number(text(root.querySelector(".pagination__item_current")?.text));
  const page = rawPage === 0 ? (Number.isSafeInteger(currentSpan) && currentSpan > 0 ? currentSpan : 1) : rawPage;
  const applications: GglApplication[] = [];
  for (const row of root.querySelectorAll(".view-request-data-row")) {
    const check = row.querySelector("input[data-comp-id][data-price]");
    const site = row.querySelector(".js-card-site-info[data-id]");
    const link = site?.querySelector("a[href]");
    const siteId = Number(site?.getAttribute("data-id"));
    const rowCampaignId = Number(check?.getAttribute("data-comp-id"));
    const siteUrl = safeGglSourceUrl(link?.getAttribute("href") ?? "");
    if (!Number.isSafeInteger(siteId) || siteId <= 0 || rowCampaignId !== campaignId || !siteUrl) {
      throw new Error("GoGetLinks вернул заявку без идентификаторов или из другой кампании");
    }
    const cell = (label: string) => text(row.querySelector(`td[data-th='${label}']`)?.text);
    const tfCf = row.querySelector("td[data-th^='Ссылочная мощь'] [data-tooltip-body]")?.getAttribute("data-tooltip-body") ?? "";
    const tf = /Trust Flow\s*-\s*(\d+)/i.exec(tfCf);
    const cf = /Citation Flow\s*-\s*(\d+)/i.exec(tfCf);
    const placementType = cell("Тип обзора");
    if (!placementType) throw new Error("GoGetLinks не вернул тип размещения");
    applications.push({
      id: `${campaignId}_${siteId}_${check?.getAttribute("name") ?? placementType}`,
      campaignId, siteId, siteUrl,
      domain: new URL(siteUrl).hostname.replace(/^www\./, ""),
      placementType,
      priceRub: gglMetric(check?.getAttribute("data-price")),
      dailyTraffic: gglMetric(cell("Трафик в сутки")),
      tf: tf ? Number(tf[1]) : null,
      cf: cf ? Number(cf[1]) : null,
      iks: gglMetric(cell("ИКС")), trust: gglMetric(cell("Траст")),
      badges: row.querySelectorAll(".site-link__status [data-tooltip-head]").map(x => text(x.getAttribute("data-tooltip-head"))),
    });
  }
  if (total > 0 && !applications.length) throw new Error("В GoGetLinks есть заявки, но таблица не прочитана");
  const pageNumbers = root.querySelectorAll(".pagination [onclick]").map(x => Number(/loadTable\((\d+)\)/.exec(x.getAttribute("onclick") ?? "")?.[1] ?? 0));
  return { applications, total, page, lastPage: Math.max(page, ...pageNumbers) };
}

export function parseGglSiteCard(html: string, siteId: number, fetchedAt = new Date().toISOString()): GglSiteCard {
  const root = parse(html);
  const info = root.querySelector(".site-info");
  if (!info) throw new Error("GoGetLinks не предоставил карточку площадки");
  const header = text(info.querySelector(".site-info__header > div")?.text);
  const observedDomain = header.replace(/^Сайт:\s*/i, "").toLowerCase().replace(/^www\./, "");
  if (!/^[a-zа-яё0-9.-]+\.[a-zа-яё0-9-]+$/i.test(observedDomain)) throw new Error("Не удалось определить домен карточки GoGetLinks");
  const domain = new URL(`https://${observedDomain}`).hostname;
  const fields: GglSiteCard["fields"] = [];
  for (const group of info.querySelectorAll(".site-info__cell")) {
    const title = text(group.querySelector(".site-info__title")?.text);
    for (const item of group.querySelectorAll(".site-info__item")) {
      const parts = item.childNodes.filter(x => x.nodeType === 1);
      const label = text(parts[0]?.text);
      const value = text(parts[1]?.text);
      if (label && value) fields.push({ group: title, label, value });
    }
  }
  if (!fields.length) throw new Error("Карточка GoGetLinks не содержит характеристик");
  const examples = info.querySelectorAll("a[href]").filter(x => /^Пример\s*\d+/i.test(text(x.text)))
    .map(x => safeGglSourceUrl(x.getAttribute("href") ?? "")).filter((x): x is string => !!x);
  return { siteId, domain, fetchedAt, fields, examples };
}

export function gglCardValue(card: GglSiteCard | null, label: string): string | null {
  return card?.fields.find(x => x.label === label)?.value ?? null;
}
