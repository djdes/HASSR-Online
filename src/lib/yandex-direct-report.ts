export const DIRECT_CAMPAIGNS = [
  { id: 715271358, name: "WeSetup — Журналы ХАССП и СанПиН | Поиск", placement: "search" },
  { id: 715282028, name: "WeSetup — Кухня без бумажных журналов | РСЯ", placement: "network" },
] as const;
export const DIRECT_REGISTRATION_GOAL = 672676203;
export const DIRECT_METRIKA_COUNTER = 108650751;
export const DIRECT_ATTRIBUTION = "AUTO";
export const DIRECT_MAX_DAYS = 366;
const DAY_MS = 86_400_000;
const allowedIds = new Set<number>(DIRECT_CAMPAIGNS.map(campaign => campaign.id));

export type DirectRange = { from: string; to: string };
export type DirectMetrics = {
  impressions: number; clicks: number; cost: number; conversions: number | null;
  ctr: number | null; cpc: number | null; conversionRate: number | null; cpa: number | null;
};
export type DirectCampaignMeta = { id: number; name: string; state: string; status: string };
export type DirectStatRow = {
  date: string; campaignId: number; campaignName: string;
  impressions: number; clicks: number; cost: number; conversions: number | null;
};
export type DirectCampaignResult = DirectCampaignMeta & {
  placement: "search" | "network"; metrics: DirectMetrics;
};
export type DirectReady = {
  status: "ready"; range: DirectRange; updatedAt: string; currency: "RUB";
  goalId: number; attribution: "AUTO"; totals: DirectMetrics;
  campaigns: DirectCampaignResult[]; daily: Array<DirectMetrics & { date: string }>;
};
export type DirectProcessing = { status: "processing"; range: DirectRange; retryAfter: number };
export type DirectStatsResult = DirectReady | DirectProcessing;
export type DirectErrorCode = "not_configured" | "provider_auth" | "provider_unavailable" | "rate_limited" | "invalid_range";

export class DirectRangeError extends Error {
  constructor() { super("invalid_range"); this.name = "DirectRangeError"; }
}
export class DirectReportError extends Error {
  constructor() { super("Invalid Direct report"); this.name = "DirectReportError"; }
}

export function moscowDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}
function dateStamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const stamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp : NaN;
}
export function directPreset(days: number, today: string = moscowDate(), offset = 0): DirectRange {
  const end = dateStamp(today) - offset * DAY_MS;
  return { from: new Date(end - (days - 1) * DAY_MS).toISOString().slice(0, 10), to: new Date(end).toISOString().slice(0, 10) };
}
export function validateDirectRange(from: string | null, to: string | null, today = moscowDate()): DirectRange {
  if (from === null && to === null) return directPreset(30, today);
  if (!from || !to) throw new DirectRangeError();
  const start = dateStamp(from), end = dateStamp(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || to > today ||
      (end - start) / DAY_MS + 1 > DIRECT_MAX_DAYS) throw new DirectRangeError();
  return { from, to };
}

function numeric(value: string | undefined, integer = false): number {
  if (value === undefined || !/^\d+(?:\.\d+)?$/.test(value.trim())) throw new DirectReportError();
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > Number.MAX_SAFE_INTEGER || (integer && !Number.isSafeInteger(result))) throw new DirectReportError();
  return result;
}
/** Reports returns a goal/model-specific column, never the all-goals total. */
export function parseDirectReport(tsv: string, range: DirectRange): DirectStatRow[] {
  const lines = tsv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (!lines.length || tsv.length > 8_000_000) throw new DirectReportError();
  const headers = lines[0].split("\t");
  const conversionHeader = `Conversions_${DIRECT_REGISTRATION_GOAL}_${DIRECT_ATTRIBUTION}`;
  const required = ["Date", "CampaignId", "CampaignName", "Impressions", "Clicks", "Cost", conversionHeader];
  if (new Set(headers).size !== headers.length || required.some(name => !headers.includes(name))) throw new DirectReportError();
  const column = (cells: string[], name: string) => cells[headers.indexOf(name)];
  const rows: DirectStatRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    if (cells.length !== headers.length) throw new DirectReportError();
    const campaignId = numeric(column(cells, "CampaignId"), true);
    if (!allowedIds.has(campaignId)) continue;
    const date = column(cells, "Date");
    if (!Number.isFinite(dateStamp(date)) || date < range.from || date > range.to) throw new DirectReportError();
    const conversion = column(cells, conversionHeader);
    rows.push({
      date, campaignId, campaignName: column(cells, "CampaignName"),
      impressions: numeric(column(cells, "Impressions"), true), clicks: numeric(column(cells, "Clicks"), true),
      cost: numeric(column(cells, "Cost")), conversions: conversion === "--" ? null : numeric(conversion),
    });
  }
  return rows;
}

export function directTotals(rows: readonly DirectStatRow[]): DirectMetrics {
  let impressions = 0, clicks = 0, costCents = 0, conversions = 0, conversionsKnown = true;
  for (const row of rows) {
    if (!allowedIds.has(row.campaignId)) continue;
    impressions += row.impressions; clicks += row.clicks; costCents += Math.round(row.cost * 100);
    if (row.conversions === null) conversionsKnown = false;
    else conversions += row.conversions;
  }
  const cost = costCents / 100;
  const registrations = conversionsKnown ? Math.round(conversions * 1_000_000) / 1_000_000 : null;
  return {
    impressions, clicks, cost, conversions: registrations,
    ctr: impressions > 0 ? clicks / impressions * 100 : null,
    cpc: clicks > 0 ? cost / clicks : null,
    conversionRate: clicks > 0 && registrations !== null ? registrations / clicks * 100 : null,
    cpa: registrations !== null && registrations > 0 ? cost / registrations : null,
  };
}

export function buildDirectReport(
  metadata: readonly DirectCampaignMeta[], sourceRows: readonly DirectStatRow[], range: DirectRange, updatedAt: string,
): DirectReady {
  const rows = sourceRows.filter(row => allowedIds.has(row.campaignId));
  const byId = new Map(metadata.filter(campaign => allowedIds.has(campaign.id)).map(campaign => [campaign.id, campaign]));
  const campaigns = DIRECT_CAMPAIGNS.flatMap(campaign => {
    const campaignRows = rows.filter(row => row.campaignId === campaign.id), meta = byId.get(campaign.id);
    if (!meta && !campaignRows.length) return [];
    return [{
      id: campaign.id, name: meta?.name || campaignRows[0]?.campaignName || campaign.name,
      state: meta?.state ?? "UNKNOWN", status: meta?.status ?? "UNKNOWN", placement: campaign.placement,
      metrics: directTotals(campaignRows),
    }];
  });
  const byDate = new Map<string, DirectStatRow[]>();
  for (const row of rows) { const group = byDate.get(row.date) ?? []; group.push(row); byDate.set(row.date, group); }
  const daily: DirectReady["daily"] = [];
  for (let stamp = dateStamp(range.from); stamp <= dateStamp(range.to); stamp += DAY_MS) {
    const date = new Date(stamp).toISOString().slice(0, 10);
    daily.push({ date, ...directTotals(byDate.get(date) ?? []) });
  }
  return { status: "ready", range, updatedAt, currency: "RUB", goalId: DIRECT_REGISTRATION_GOAL,
    attribution: DIRECT_ATTRIBUTION, totals: directTotals(rows), campaigns, daily };
}