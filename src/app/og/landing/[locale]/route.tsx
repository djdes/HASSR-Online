import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isLocale, LOCALES } from "@/i18n/locales";
import { translatorFor } from "@/i18n/translator";
import { localizedHref } from "@/i18n/site-locale";
import { JOURNALS_TOTAL } from "@/lib/journal-catalog";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const dynamicParams = false;
export function generateStaticParams() { return LOCALES.map(locale => ({ locale })); }

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) return new Response(null, { status: 404 });
  const t = await translatorFor(locale);
  const font = await readFile(path.join(process.cwd(), "src/lib/pdf-fonts/DejaVuSans.ttf"));
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 80px", background: "linear-gradient(135deg, #0b1024, #1a2147, #2d2670)", color: "white", fontFamily: "WeSetupOG" }}>
      <div style={{ display: "flex", fontSize: 48, fontWeight: 700 }}>WeSetup</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>{t("landing.openGraph.title")}</div>
        <div style={{ display: "flex", fontSize: 30, color: "#c8cff3" }}>{t("landing.openGraph.subtitle")}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 23, color: "#7cf5c0" }}>
        <span>{t("landing.openGraph.features", { count: JOURNALS_TOTAL })}</span>
        <span>{`wesetup.ru${localizedHref("/", locale)}`}</span>
      </div>
    </div>,
    { width: 1200, height: 630, fonts: [{ name: "WeSetupOG", data: font, weight: 400 }], headers: { "Cache-Control": "public, max-age=86400", "Content-Language": locale } },
  );
}
