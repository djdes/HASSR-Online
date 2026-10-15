import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { OG_KINDS, clampOgText, type OgKind } from "@/lib/og-image";
import { parseSiteLocale } from "@/i18n/site-locale";
import { loadMessages } from "@/i18n/messages";

// nodejs runtime — см. og-default: edge требует wasm-bundle resvg, которого
// нет в deploy.tar. Кэш — публичный на сутки: next.config и src/proxy.ts
// исключают `/og/` из глобального no-store.
const SITE = "https://wesetup.ru";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIZE = { width: 1200, height: 630 } as const;
const FONT_FAMILY = "WeSetup Unicode";
let fonts: Promise<Array<{ name: string; data: Buffer; weight: 400 | 700; style: "normal" }>> | undefined;

function loadFonts() {
  return fonts ??= Promise.all(([
    ["DejaVuSans.ttf", 400], ["DejaVuSans-Bold.ttf", 700],
  ] as const).map(async ([file, weight]) => ({
    name: FONT_FAMILY,
    data: await readFile(join(process.cwd(), "src", "lib", "pdf-fonts", String(file))),
    weight,
    style: "normal" as const,
  })));
}

/**
 * OG-картинка под конкретную страницу: `/og/image?t=<заголовок>&s=<подзаголовок>&k=<вид>`.
 * Та же композиция, что у /og-default (бренд, тёмный градиент, пилюли),
 * но с текстом страницы — в Telegram и соцсетях превью отличаются друг от
 * друга, а не показывают одну общую картинку.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locale = parseSiteLocale(searchParams.get("l"));
  const copy = (await loadMessages(locale)).publicOg;
  const title = clampOgText(searchParams.get("t"), 90) || copy.fallbackTitle;
  const subtitle = clampOgText(searchParams.get("s"), 140);
  const kindRaw = searchParams.get("k") ?? "";
  const kind = OG_KINDS.includes(kindRaw as OgKind) ? (kindRaw as OgKind) : "page";
  const titleSize = title.length > 60 ? 52 : title.length > 40 ? 60 : 72;

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 80px",
          background: "linear-gradient(135deg, #0b1024 0%, #1a2147 50%, #2d2670 100%)",
          color: "#ffffff",
          fontFamily: FONT_FAMILY,
          position: "relative",
        }}
      >
        <div style={{ position: "absolute", top: -180, left: -120, width: 520, height: 520, borderRadius: "50%", background: "#5566f6", opacity: 0.35, filter: "blur(120px)" }} />
        <div style={{ position: "absolute", bottom: -200, right: -180, width: 560, height: 560, borderRadius: "50%", background: "#7a5cff", opacity: 0.3, filter: "blur(140px)" }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${SITE}/brand/wordmark-dark.png`} width={240} height={63} alt="WeSetup" />
          <div
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.22)",
              fontSize: 22,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              display: "flex",
            }}
          >
            {copy.kind[kind]}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, zIndex: 10 }}>
          <div style={{ display: "flex", fontSize: titleSize, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.08, maxWidth: 1040 }}>{title}</div>
          {subtitle ? (
            <div style={{ display: "flex", fontSize: 28, fontWeight: 400, opacity: 0.78, maxWidth: 1000, lineHeight: 1.35 }}>{subtitle}</div>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, zIndex: 10 }}>
          <div style={{ padding: "10px 18px", borderRadius: 999, background: "rgba(124, 245, 192, 0.18)", color: "#7cf5c0", fontSize: 22, fontWeight: 500, border: "1px solid rgba(124, 245, 192, 0.4)", display: "flex" }}>
            {copy.freeForever}
          </div>
          <div style={{ padding: "10px 18px", borderRadius: 999, background: "rgba(255,255,255,0.1)", fontSize: 22, border: "1px solid rgba(255,255,255,0.22)", display: "flex" }}>
            wesetup.ru
          </div>
        </div>
      </div>
    ),
    { ...SIZE, fonts: await loadFonts() }
  );
  image.headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  image.headers.set("Content-Language", locale);
  return image;
}
