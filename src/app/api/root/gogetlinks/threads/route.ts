import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRoot } from "@/lib/auth-helpers";
import {
  GglAuthError,
  GglCallError,
  GglIsolationError,
} from "@/lib/seo/gogetlinks-client.server";
import { GglChatError, listGglThreads } from "@/lib/seo/gogetlinks-chat.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const booleanQueryFlag = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((val) => val === "true" || val === "1");

const threadsQuerySchema = z.object({
  onlyUnread: booleanQueryFlag,
  needsReply: booleanQueryFlag,
  includeOtherProjects: booleanQueryFlag,
});

export async function GET(request: Request) {
  await requireRoot();

  const url = new URL(request.url);
  const parsed = threadsQuerySchema.safeParse({
    onlyUnread: url.searchParams.get("onlyUnread") ?? undefined,
    needsReply: url.searchParams.get("needsReply") ?? undefined,
    includeOtherProjects: url.searchParams.get("includeOtherProjects") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные параметры фильтра чатов" },
      { status: 400 },
    );
  }

  try {
    const threads = await listGglThreads({
      onlyUnread: parsed.data.onlyUnread,
      needsReply: parsed.data.needsReply,
      includeOtherProjects: parsed.data.includeOtherProjects,
    });
    return NextResponse.json({
      includeOtherProjects: parsed.data.includeOtherProjects,
      threads,
    });
  } catch (err) {
    if (err instanceof GglChatError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof GglIsolationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof GglAuthError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof GglCallError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[ggl-threads] unexpected error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Не удалось загрузить диалоги GoGetLinks" },
      { status: 500 },
    );
  }
}
