import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { POSTERS, findPoster, selectPosters } from "@/lib/ppk/posters";
import { posterPointLine, posterPointParam, resolvePosterPoint } from "@/lib/ppk/poster-point";
import { loadJournalQrSvg, loadPosterPoints } from "@/lib/ppk/poster-data.server";
import { isMonoParam } from "@/lib/print-brand";
import { loadPrintBrand } from "@/lib/print-brand.server";
import { PrintJournalButton } from "@/components/journals/print-journal-button";
import { PosterSheet } from "@/components/production-control/poster-sheet";

export const dynamic = "force-dynamic";

const BASE = "/production-control/documents/posters";

/**
 * Печать плакатов: один ключ или `all` (все; `?keys=a,b` — только выбранные,
 * в порядке каталога). `?bw=1` — чёрно-белый режим, `?point=<id>` — торговая
 * точка (её название на каждом листе, QR осмотра — в её журнал); без точки или
 * с чужой — точка по умолчанию (`resolvePosterPoint`). Каждый плакат — на
 * отдельном листе A4.
 */
export default async function PosterPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ [name: string]: string | string[] | undefined }>;
}) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const { key } = await params;
  const query = await searchParams;
  const mono = isMonoParam(query.bw);

  const poster = key === "all" ? null : findPoster(key);
  if (key !== "all" && !poster) notFound();
  const rawKeys = Array.isArray(query.keys) ? query.keys.join(",") : (query.keys ?? "");
  const keys = rawKeys.split(",").map((value) => value.trim()).filter(Boolean);
  const picked = !poster && keys.length > 0 ? selectPosters(keys) : [];
  const list = poster ? [poster] : picked.length > 0 ? picked : POSTERS;

  const organizationId = getActiveOrgId(session);
  const needsQr = list.some((item) => item.blocks.some((block) => block.type === "journalQr"));
  const [brand, t, { points, headerPointId }] = await Promise.all([
    loadPrintBrand(organizationId, { mono }),
    getTranslations("productionControl.posters"),
    loadPosterPoints(session),
  ]);
  const point = resolvePosterPoint(points, posterPointParam(query.point), headerPointId);
  const pointLine = posterPointLine(point);
  const qrSvg = needsQr ? await loadJournalQrSvg(organizationId, "hygiene", brand, point?.id ?? null) : null;

  const params2 = new URLSearchParams();
  if (!poster && picked.length > 0) params2.set("keys", picked.map((item) => item.key).join(","));
  // Точку держим в адресе, только если выбирать есть из чего.
  if (point && points.length > 1) params2.set("point", point.id);
  const here = (bw: boolean) => {
    const next = new URLSearchParams(params2);
    if (bw) next.set("bw", "1");
    const text = next.toString();
    return `${BASE}/${key}${text ? `?${text}` : ""}`;
  };
  const back = point && points.length > 1 ? `${BASE}?point=${encodeURIComponent(point.id)}` : BASE;

  return (
    <div className="space-y-6" data-poster-print-root>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          href={back}
          className="inline-flex h-10 items-center gap-2 rounded-2xl px-3 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={here(!mono)}
            role="switch"
            aria-checked={mono}
            title={t("bwHint")}
            className={`inline-flex h-10 items-center gap-2 rounded-2xl border px-4 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
              mono
                ? "border-[#0b1024] bg-[#0b1024] text-white hover:bg-[#1c2240]"
                : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            }`}
          >
            {t("bw")}
          </Link>
          <PrintJournalButton label={t("print")} />
        </div>
      </div>
      {list.map((item, index) => (
        // В печати без отступа между листами: отступ после листа в 273 мм не
        // помещался на A4 и добавлял пустую страницу в конце.
        <div key={item.key} className={`print:m-0 ${index < list.length - 1 ? "print:break-after-page" : ""}`}>
          <PosterSheet poster={item} brand={brand} qrSvg={qrSvg} point={pointLine} />
        </div>
      ))}
    </div>
  );
}
