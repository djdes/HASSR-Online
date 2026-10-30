import { NextResponse } from "next/server";
import { requireSuperRoot } from "@/lib/auth-helpers";
import { listPlatformTeam, searchTeamCandidates } from "@/lib/platform-team.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Panel team (owner only): GET — members; GET ?q= — people to add. */
export async function GET(request: Request) {
  await requireSuperRoot();
  const q = new URL(request.url).searchParams.get("q");
  if (q !== null) return NextResponse.json({ candidates: await searchTeamCandidates(q) });
  return NextResponse.json({ members: await listPlatformTeam() });
}
