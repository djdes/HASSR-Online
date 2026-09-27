import { readFile } from "fs/promises";
import { NextResponse } from "next/server";

import { normalizeBuildId } from "@/lib/build-version";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function readBuildFile(filename: string, fallback: string) {
  try {
    return (await readFile(filename, "utf-8")).trim();
  } catch {
    return fallback;
  }
}

/**
 * Версия сборки, которая СЕЙЧАС обслуживает сайт.
 *
 * Берём id, запечённый в код при сборке (`NEXT_PUBLIC_BUILD_ID`), — тот же,
 * что у страниц в браузере (`pageBuildId()`), и вкладка сравнивает
 * настоящие версии. `.build-sha` деплой пишет в САМОМ НАЧАЛЕ, минуты до
 * переключения на новую сборку: раньше в это окно вкладки получали «новую»
 * версию от старого сайта — перезагружались на старое и запоминали новое,
 * а когда новое реально выходило, уже не обновлялись (2026-09-27).
 * Файл — только запасной вариант (сборка без id).
 */
export async function GET() {
  const fileBuildId = await readBuildFile(".build-sha", "");
  const servingBuildId =
    normalizeBuildId(process.env.NEXT_PUBLIC_BUILD_ID) ??
    normalizeBuildId(fileBuildId) ??
    "dev";
  const buildTime =
    process.env.NEXT_PUBLIC_BUILD_TIME ||
    (await readBuildFile(".build-time", new Date().toISOString()));

  return NextResponse.json(
    {
      buildId: servingBuildId,
      buildTime,
      fullBuildId: fileBuildId.startsWith(servingBuildId) ? fileBuildId : servingBuildId,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    }
  );
}
