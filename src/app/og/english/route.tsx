import { ImageResponse } from "next/og";
import { JOURNALS_TOTAL } from "@/lib/journal-catalog";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = false;

export function GET() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 80px", background: "linear-gradient(135deg, #0b1024, #1a2147, #2d2670)", color: "white", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", fontSize: 48, fontWeight: 700 }}>WeSetup</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.1 }}>Digital HACCP &amp; SanPiN logs</div>
        <div style={{ display: "flex", fontSize: 30, color: "#c8cff3" }}>Food safety records for food service and production</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 25, color: "#7cf5c0" }}>
        <span>{JOURNALS_TOTAL} logs · QR entry · Automated reminders</span>
        <span>wesetup.ru/en</span>
      </div>
    </div>,
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
