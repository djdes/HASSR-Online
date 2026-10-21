import { requireRoot } from "@/lib/auth-helpers";
import { createDirectStatsHandler } from "@/lib/yandex-direct-handler";
import { readDirectStats } from "@/lib/yandex-direct-stats.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createDirectStatsHandler({ authorize: requireRoot, read: readDirectStats });