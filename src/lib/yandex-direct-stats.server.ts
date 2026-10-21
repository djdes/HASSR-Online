import { createHash, randomUUID } from "node:crypto";
import {
  DIRECT_CAMPAIGNS, DIRECT_REGISTRATION_GOAL, DIRECT_ATTRIBUTION,
  buildDirectReport, parseDirectReport,
  type DirectRange, type DirectCampaignMeta, type DirectReady, type DirectStatsResult, type DirectErrorCode,
} from "./yandex-direct-report";

const API = "https://api.direct.yandex.com/json/v5/";
const CACHE_MS = 120_000;
const JOB_TIMEOUT_MS = 600_000;
const MAX_WINDOWS = 16;

export class DirectApiError extends Error {
  constructor(readonly code: DirectErrorCode, readonly retryAfter?: number) {
    super(code); this.name = "DirectApiError";
  }
}
type Entry = {
  range: DirectRange; name: string; createdAt: number; nextAttemptAt: number;
  campaigns?: DirectCampaignMeta[]; ready?: DirectReady; inflight?: Promise<DirectStatsResult>;
};
type Options = { token: string; clientLogin?: string; fetcher?: typeof fetch; now?: () => number };

function retrySeconds(value: string | null): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(60, Math.max(1, Math.ceil(number))) : 5;
}

/** Read-only reporting. No campaign/goal/budget writes are reachable here. */
export class DirectStatsReader {
  private readonly cache = new Map<string, Entry>();
  private nextReportAt = 0;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  constructor(private readonly options: Options) {
    this.fetcher = options.fetcher ?? fetch; this.now = options.now ?? Date.now;
  }

  async read(range: DirectRange, refresh = false): Promise<DirectStatsResult> {
    const key = `${range.from}:${range.to}`, now = this.now();
    let entry = this.cache.get(key);
    if (entry?.inflight) return entry.inflight;
    if (entry?.ready && now - Date.parse(entry.ready.updatedAt) < CACHE_MS && (!refresh || now - Date.parse(entry.ready.updatedAt) < 10_000)) return entry.ready;
    if (entry && !entry.ready && now - entry.createdAt > JOB_TIMEOUT_MS) {
      this.cache.delete(key); throw new DirectApiError("provider_unavailable");
    }
    if (entry && !entry.ready && now < entry.nextAttemptAt) {
      return { status: "processing", range, retryAfter: Math.max(1, Math.ceil((entry.nextAttemptAt - now) / 1000)) };
    }
    if (!entry || entry.ready) {
      if (this.cache.size >= MAX_WINDOWS) this.cache.delete(this.cache.keys().next().value as string);
      entry = { range, name: `wesetup_signups_${range.from}_${range.to}_${randomUUID()}`, createdAt: now, nextAttemptAt: 0 };
      this.cache.set(key, entry);
    }
    const current = entry;
    current.inflight = this.load(current).finally(() => { current.inflight = undefined; });
    try { return await current.inflight; }
    catch (error) {
      if (error instanceof DirectApiError && error.code === "rate_limited") {
        current.nextAttemptAt = this.now() + Math.max(10, error.retryAfter ?? 10) * 1000;
        this.nextReportAt = Math.max(this.nextReportAt, current.nextAttemptAt);
      } else if (this.cache.get(key) === current) this.cache.delete(key);
      if (error instanceof DirectApiError) throw error;
      throw new DirectApiError("provider_unavailable");
    }
  }

  private async request(service: "campaigns" | "reports", body: object): Promise<Response> {
    try {
      return await this.fetcher(API + service, {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(12_000),
        headers: {
          Authorization: `Bearer ${this.options.token}`, "Accept-Language": "ru",
          "Content-Type": "application/json; charset=utf-8",
          ...(this.options.clientLogin ? { "Client-Login": this.options.clientLogin } : {}),
          ...(service === "reports" ? {
            processingMode: "auto", returnMoneyInMicros: "false", skipReportHeader: "true", skipReportSummary: "true",
          } : {}),
        }, body: JSON.stringify(body),
      });
    } catch { throw new DirectApiError("provider_unavailable"); }
  }

  private async assertResponse(response: Response): Promise<void> {
    if (response.status === 429) throw new DirectApiError("rate_limited", retrySeconds(response.headers.get("retryIn") ?? response.headers.get("Retry-After")));
    if (response.status === 401 || response.status === 403) throw new DirectApiError("provider_auth");
    if (!response.ok) throw new DirectApiError("provider_unavailable");
  }

  private async campaigns(): Promise<DirectCampaignMeta[]> {
    const response = await this.request("campaigns", { method: "get", params: {
      SelectionCriteria: { Ids: DIRECT_CAMPAIGNS.map(campaign => campaign.id) },
      FieldNames: ["Id", "Name", "State", "Status", "Type"],
    } });
    await this.assertResponse(response);
    const body = await response.json() as { result?: { Campaigns?: Array<{ Id: number; Name: string; State: string; Status: string }> }; error?: { error_code?: number } };
    if (body.error) throw new DirectApiError([52, 53, 54, 58, 513, 1002].includes(body.error.error_code ?? 0) ? "provider_auth" : "provider_unavailable");
    if (!Array.isArray(body.result?.Campaigns)) throw new DirectApiError("provider_unavailable");
    return body.result.Campaigns.filter(campaign => DIRECT_CAMPAIGNS.some(allowed => allowed.id === campaign.Id)).map(campaign => {
      if (!campaign.Name || typeof campaign.State !== "string" || typeof campaign.Status !== "string") throw new DirectApiError("provider_unavailable");
      return { id: campaign.Id, name: campaign.Name, state: campaign.State, status: campaign.Status };
    });
  }

  private async load(entry: Entry): Promise<DirectStatsResult> {
    entry.campaigns ??= await this.campaigns();
    const delay = Math.max(entry.nextAttemptAt, this.nextReportAt) - this.now();
    if (delay > 0) return { status: "processing", range: entry.range, retryAfter: Math.ceil(delay / 1000) };
    this.nextReportAt = this.now() + 10_000;
    const response = await this.request("reports", { params: {
      SelectionCriteria: {
        DateFrom: entry.range.from, DateTo: entry.range.to,
        Filter: [{ Field: "CampaignId", Operator: "IN", Values: DIRECT_CAMPAIGNS.map(campaign => String(campaign.id)) }],
      },
      Goals: [String(DIRECT_REGISTRATION_GOAL)], AttributionModels: [DIRECT_ATTRIBUTION],
      FieldNames: ["Date", "CampaignId", "CampaignName", "Impressions", "Clicks", "Cost", "Conversions"],
      ReportName: entry.name, ReportType: "CUSTOM_REPORT", DateRangeType: "CUSTOM_DATE", Format: "TSV",
      IncludeVAT: "YES", IncludeDiscount: "NO", OrderBy: [{ Field: "Date" }],
    } });
    if (response.status === 201 || response.status === 202) {
      const retryAfter = Math.max(10, retrySeconds(response.headers.get("retryIn")));
      entry.nextAttemptAt = this.now() + retryAfter * 1000;
      return { status: "processing", range: entry.range, retryAfter };
    }
    // Direct can return method throttling as HTTP 400 / error 56, even after retryIn.
    if (response.status === 400) {
      const body = await response.clone().json().catch(() => null) as { error?: { error_code?: number } } | null;
      if (body?.error?.error_code === 56) {
        entry.nextAttemptAt = this.now() + 10_000;
        this.nextReportAt = entry.nextAttemptAt;
        return { status: "processing", range: entry.range, retryAfter: 10 };
      }
    }
    await this.assertResponse(response);
    const rows = parseDirectReport(await response.text(), entry.range);
    entry.ready = buildDirectReport(entry.campaigns, rows, entry.range, new Date(this.now()).toISOString());
    return entry.ready;
  }
}

let active: { fingerprint: string; reader: DirectStatsReader } | undefined;
export function readDirectStats(range: DirectRange, refresh = false): Promise<DirectStatsResult> {
  const token = (process.env.YANDEX_DIRECT_OAUTH_TOKEN || process.env.YANDEX_OAUTH_TOKEN || "").trim();
  const clientLogin = process.env.YANDEX_DIRECT_CLIENT_LOGIN?.trim();
  if (!token) throw new DirectApiError("not_configured");
  const fingerprint = createHash("sha256").update(`${token}\0${clientLogin ?? ""}`).digest("hex");
  if (active?.fingerprint !== fingerprint) active = { fingerprint, reader: new DirectStatsReader({ token, clientLogin }) };
  return active.reader.read(range, refresh);
}