import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { JOURNAL_ENABLE_AUDIT_ACTION, type JournalEnableSource } from "@/lib/blank-signup";
import { getDisabledJournalCodes, setDisabledJournalCodes } from "@/lib/disabled-journals";
import { checkJournalLimit, limitResponse } from "@/lib/billing.server";
import { journalSettingsPointId, journalSettingsWriteTarget } from "@/lib/journal-settings-target";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import {
  JOURNAL_SETS,
  JOURNAL_SET_IDS,
  enableJournalSetCodes,
  isJournalSetId,
  journalSetStatus,
} from "@/lib/journal-sets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAMES = new Map<string, string>(ACTIVE_JOURNAL_CATALOG.map((item) => [item.code, item.name]));
const SOURCE: JournalEnableSource = "journal-set";

/**
 * Наборы журналов: «Стандартный», «По ХАССП», «Дополнительные»
 * (`src/lib/journal-sets.ts`).
 *
 * GET — наборы с пунктами и признаком «включён» у текущей организации.
 * POST `{ set: "standard" | "haccp" }` — «Включить весь набор» одним
 * нажатием. Дельта, как у POST /api/settings/journals/<код>/enable:
 * убираем из выключенных только основные журналы набора, чужие изменения
 * из другой вкладки не затираются. Журнал здоровья (связанный пункт
 * стандартного набора) не включается. Каждое включение — в AuditLog.
 *
 * Права — как у «Набора журналов» в настройках: руководитель.
 */
async function requireManager() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Наборы журналов настраивает руководитель" }, { status: 403 }),
    };
  }
  return auth;
}

function presentSets(disabled: ReadonlySet<string>) {
  return JOURNAL_SET_IDS.map((id) => {
    const set = JOURNAL_SETS[id];
    const items = journalSetStatus(id, disabled).map((item) => ({
      code: item.code,
      name: NAMES.get(item.code) ?? item.code,
      enabled: item.enabled,
      related: (item.related ?? []).map((code) => ({
        code,
        name: NAMES.get(code) ?? code,
        enabled: !disabled.has(code),
      })),
    }));
    return {
      id,
      title: set.title,
      description: set.description,
      bulkEnable: set.bulkEnable,
      total: items.length,
      enabledCount: items.filter((item) => item.enabled).length,
      items,
    };
  });
}

export async function GET() {
  const auth = await requireManager();
  if (!auth.ok) return auth.response;
  const disabled = await getDisabledJournalCodes(getActiveOrgId(auth.session), await journalSettingsPointId(auth.session));
  return NextResponse.json(
    { sets: presentSets(disabled) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await requireManager();
  if (!auth.ok) return auth.response;
  const session = auth.session;

  const body = (await request.json().catch(() => null)) as { set?: unknown } | null;
  const setId = body?.set;
  if (!isJournalSetId(setId)) {
    return NextResponse.json({ error: "Неизвестный набор журналов" }, { status: 400 });
  }
  if (!JOURNAL_SETS[setId].bulkEnable) {
    return NextResponse.json(
      { error: "Дополнительные журналы включаются по одному — выберите нужные" },
      { status: 400 },
    );
  }

  const organizationId = getActiveOrgId(session);
  // Точка из шапки — её набор; «Вся организация» — набор всех точек.
  const target = await journalSettingsWriteTarget(session);
  if (!target.ok) return target.response;
  const buildingId = target.pointId;
  const disabled = await getDisabledJournalCodes(organizationId, buildingId);
  const next = enableJournalSetCodes(disabled, setId);
  if (next.enabled.length > 0) {
    // Бесплатный тариф после пробного — один включённый журнал.
    const journals = await checkJournalLimit(organizationId, next.disabledCodes, { source: `settings/journals/sets:${setId}` });
    if (!journals.ok) return limitResponse(journals);
    await setDisabledJournalCodes(organizationId, next.disabledCodes, buildingId);
    for (const code of next.enabled) {
      await recordAuditLog({
        request,
        session,
        organizationId,
        action: JOURNAL_ENABLE_AUDIT_ACTION,
        entity: "JournalTemplate",
        entityId: code,
        details: { journalCode: code, via: SOURCE, journalSet: setId },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    set: setId,
    // Коды, которые этот вызов включил; повторный вызов — `changed: []`.
    changed: next.enabled,
    sets: presentSets(new Set(next.disabledCodes)),
  });
}
