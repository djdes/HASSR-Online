export interface DonorSiteFit {
  version: 1;
  targetUrl: string;
  checkedAt: number;
  level: "topic" | "audience";
  score: number;
  publications: { title: string; url: string }[];
}

export function readDonorSiteFit(metrics: unknown, targetUrl: string | null): DonorSiteFit | null {
  if (!metrics || typeof metrics !== "object" || !("siteFit" in metrics)) return null;
  const fit = metrics.siteFit as DonorSiteFit | null;
  if (fit?.version !== 1 || !targetUrl || fit.targetUrl !== targetUrl ||
      !Number.isFinite(fit.checkedAt) || Date.now() - fit.checkedAt > 7 * 86_400_000 ||
      (fit.level !== "topic" && fit.level !== "audience") ||
      !Number.isFinite(fit.score) || fit.score <= 0 || !Array.isArray(fit.publications)) return null;
  const publications = fit.publications.filter(
    (entry) => typeof entry?.title === "string" && typeof entry.url === "string" &&
      /^https:\/\//.test(entry.url),
  ).slice(0, 3);
  return publications.length >= 2 ? { ...fit, publications } : null;
}

export function isGglSlotReadyForApproval(slot: {
  status: string;
  donorSiteId: number | null;
  targetUrl: string | null;
  anchor: string | null;
  donorMetricsJson: unknown;
}): boolean {
  return slot.status === "pending_approval" && Boolean(
    slot.donorSiteId && slot.anchor && readDonorSiteFit(slot.donorMetricsJson, slot.targetUrl),
  );
}
