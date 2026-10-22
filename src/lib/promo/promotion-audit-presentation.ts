import { describePromotion, describePromotionChange, type PromotionAuditEntry } from "./promotions";

type Snapshot = { title: string; percent: number; startsAt: string; endsAt: string; active: boolean };
export type PromotionAuditPresentation =
  | { version: 1; kind: "change"; before: Snapshot; after: Snapshot; noteChanged: boolean }
  | { version: 1; kind: "create" | "delete"; percent: number; startsAt: string; endsAt: string; active: boolean };
export type PresentedPromotionAuditEntry = PromotionAuditEntry & { presentation?: PromotionAuditPresentation };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function snapshot(value: unknown): Snapshot | null {
  if (!record(value) || !["title", "percent", "startsAt", "endsAt", "active"].every(key => Object.hasOwn(value, key))) return null;
  if (typeof value.title !== "string" || typeof value.percent !== "number" || !Number.isInteger(value.percent) || value.percent < 1 || value.percent > 90 || typeof value.active !== "boolean") return null;
  for (const key of ["startsAt", "endsAt"] as const) {
    const input = value[key];
    if (typeof input !== "string") return null;
    const time = new Date(input).getTime();
    if (!Number.isFinite(time) || new Date(time).toISOString() !== input || !Number.isFinite(new Date(time + 3 * 60 * 60 * 1000).getTime())) return null;
  }
  const startsAt = value.startsAt as string, endsAt = value.endsAt as string;
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return null;
  return { title: value.title, percent: value.percent, startsAt, endsAt, active: value.active };
}
function producerInput(value: Snapshot, noteChanged = false) {
  return { ...value, startsAt: new Date(value.startsAt), endsAt: new Date(value.endsAt), note: noteChanged ? "changed" : null };
}

/** Known-producer compatibility only; unknown history retains its original summary. */
export function inferPromotionAuditPresentation(action: string, details: unknown): PromotionAuditPresentation | undefined {
  if (!record(details) || !Object.hasOwn(details, "title") || typeof details.title !== "string" || !Object.hasOwn(details, "summary") || typeof details.summary !== "string") return undefined;
  if (action === "promotion.update" || action === "promotion.enable" || action === "promotion.disable") {
    if (!Object.hasOwn(details, "before") || !Object.hasOwn(details, "after")) return undefined;
    const before = snapshot(details.before), after = snapshot(details.after);
    if (!before || !after || details.title !== after.title) return undefined;
    const matches: PromotionAuditPresentation[] = [];
    for (const noteChanged of [false, true]) {
      const summary = describePromotionChange(producerInput(before), producerInput(after, noteChanged));
      const classified = before.active !== after.active && summary === (after.active ? "включена" : "выключена")
        ? after.active ? "promotion.enable" : "promotion.disable" : "promotion.update";
      if (summary === details.summary && action === classified) matches.push({ version: 1, kind: "change", before, after, noteChanged });
    }
    return matches.length === 1 ? matches[0] : undefined;
  }
  if (action === "promotion.create" || action === "promotion.delete") {
    const value = snapshot(details);
    if (!value) return undefined;
    const summary = describePromotion(producerInput(value)) + (action === "promotion.create" && !value.active ? " · выключена" : "");
    if (summary === details.summary) return { version: 1, kind: action === "promotion.create" ? "create" : "delete", percent: value.percent, startsAt: value.startsAt, endsAt: value.endsAt, active: value.active };
  }
  return undefined;
}

/** Validate the optional wire value again, including consistency with the untouched row. */
export function readPromotionAuditPresentation(entry: PromotionAuditEntry & { presentation?: unknown }): PromotionAuditPresentation | undefined {
  const value = entry.presentation;
  if (!record(value) || !Object.hasOwn(value, "version") || value.version !== 1 || !Object.hasOwn(value, "kind")) return undefined;
  if (value.kind === "change") {
    if (!["before", "after", "noteChanged"].every(key => Object.hasOwn(value, key)) || typeof value.noteChanged !== "boolean") return undefined;
    const result = inferPromotionAuditPresentation(entry.action, { title: entry.title, summary: entry.summary, before: value.before, after: value.after });
    return result?.kind === "change" && result.noteChanged === value.noteChanged ? result : undefined;
  }
  if (value.kind === "create" || value.kind === "delete") {
    if (!["percent", "startsAt", "endsAt", "active"].every(key => Object.hasOwn(value, key)) || entry.action !== `promotion.${value.kind}`) return undefined;
    return inferPromotionAuditPresentation(entry.action, { title: entry.title, summary: entry.summary, percent: value.percent, startsAt: value.startsAt, endsAt: value.endsAt, active: value.active });
  }
  return undefined;
}
