import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { generatePoolForDay, type TaskScope } from "@/lib/journal-task-pool";
import { type ClaimRow } from "@/lib/journal-task-claims";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { hasJournalAccess } from "@/lib/journal-acl";
import { resolveDayStart } from "@/lib/today-compliance";
import { journalIconName, looksLikeJournalCode } from "@/lib/journal-label";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mini/today — единый список ВСЕХ доступных сотруднику задач
 * на сегодня по всем pool-журналам организации.
 *
 * Объединяет pool generator'ы из journal-task-pool по всем enabled
 * журналам. Возвращает плоский список с группировкой по journalCode.
 */

const POOL_CODES = [
  "hygiene",
  "health_check",
  "cold_equipment_control",
  "climate_control",
  "cleaning",
  "incoming_control",
  "finished_product",
  "disinfectant_usage",
  "fryer_oil",
  "accident_journal",
  "complaint_register",
  "breakdown_history",
  "ppe_issuance",
  "glass_items_list",
  "glass_control",
  "metal_impurity",
  "perishable_rejection",
  "product_writeoff",
  "traceability_test",
  "general_cleaning",
  "sanitation_day_control",
  "sanitary_day_control",
  "pest_control",
  "intensive_cooling",
  "uv_lamp_runtime",
  "equipment_maintenance",
  "equipment_calibration",
  "equipment_cleaning",
  "audit_plan",
  "audit_protocol",
  "audit_report",
  "training_plan",
];

const JOURNAL_LABELS: Record<string, string> = {
  hygiene: "Гигиена",
  health_check: "Проверка здоровья",
  cold_equipment_control: "Холодильники",
  climate_control: "Климат",
  cleaning: "Уборка",
  incoming_control: "Приёмка",
  finished_product: "Бракераж",
  disinfectant_usage: "Дезсредства",
  fryer_oil: "Фритюр",
  accident_journal: "Аварии",
  complaint_register: "Жалобы",
  breakdown_history: "Поломки",
  ppe_issuance: "СИЗ",
  glass_items_list: "Стекло (список)",
  glass_control: "Контроль стекла",
  metal_impurity: "Металлопримеси",
  perishable_rejection: "Скоропорт",
  product_writeoff: "Списание",
  traceability_test: "Прослеживаемость",
  general_cleaning: "Генуборка",
  sanitation_day_control: "Сан. день",
  sanitary_day_control: "Чек-лист сан. дня",
  pest_control: "Дератизация",
  intensive_cooling: "Интенс. охл.",
  uv_lamp_runtime: "УФ-лампа",
  equipment_maintenance: "Тех. обслуж.",
  equipment_calibration: "Поверка",
  equipment_cleaning: "Чистка обор.",
  audit_plan: "План аудита",
  audit_protocol: "Протокол аудита",
  audit_report: "Отчёт аудита",
  training_plan: "План обучения",
};

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const organizationId = getActiveOrgId(session);
  const userId = session.user.id;

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { disabledJournalCodes: true, timezone: true },
  });
  const disabled = parseDisabledCodes(org?.disabledJournalCodes);

  // «Сегодня» — по поясу организации, а не по UTC. С 00:00 до 03:00 по
  // Москве процесс на сервере живёт ещё во вчера: экран показывал
  // вчерашнюю дату, claim'ы сохранялись под вчерашним `dateKey`, и у
  // заведующей одна задача висела сразу в «Ждут проверки» и «Ещё не
  // взято». Тот же помощник, что у /api/verifications и /api/control-board.
  const today = resolveDayStart(org?.timezone ?? null, new Date());
  const dateKey = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  // Активные задачи сотрудника — все, любого дня. Взятая вчера и не
  // закрытая задача остаётся его: её можно открыть и доделать, и
  // отдельной плашкой она видна в списке.
  const myActiveClaims = await db.journalTaskClaim.findMany({
    where: { organizationId, userId, status: "active" },
    orderBy: { claimedAt: "desc" },
  });
  const myActiveToday =
    myActiveClaims.find(
      (c) => c.dateKey >= today && c.dateKey < tomorrow
    ) ?? null;
  const stuckClaims = myActiveClaims.filter((c) => c.dateKey < today);

  type EnrichedScope = TaskScope & {
    journalCode: string;
    journalLabel: string;
    /** Имя иконки lucide — подбирается по виду журнала, см. journal-label.ts. */
    iconName: string;
    availability: "available" | "mine" | "taken" | "completed";
    claimUserName?: string | null;
    claimId?: string;
  };

  const groups: { code: string; label: string; scopes: EnrichedScope[] }[] = [];

  // Раньше: показывали task pool ЛЮБОГО pool-журнала всем сотрудникам.
  // Уборщица видела scope'ы health_check (медосмотр) с именами коллег,
  // даже если её ACL запрещает доступ к этому журналу. Фильтруем по
  // hasJournalAccess — management/root проходят без фильтра.
  //
  // Pass-3 HIGH #5 — N+1 fix: раньше цикл по 32 кодам делал по 2
  // sequential query (generatePool + listClaims) на каждый = 64
  // queries в худшем случае. Теперь:
  //   1. ACL для всех кодов параллельно (LRU-cached, но parallelism
  //      помогает на cold cache).
  //   2. ОДИН batch query на все claims (`journalCode: { in: ... }`).
  //   3. generatePoolForDay параллельно для allowed-кодов.
  const aclActor = {
    id: userId,
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  };

  const candidateCodes = POOL_CODES.filter((c) => !disabled.has(c));
  const aclResults = await Promise.all(
    candidateCodes.map((c) => hasJournalAccess(aclActor, c))
  );
  const allowedCodes = candidateCodes.filter((_, i) => aclResults[i]);

  // Название журнала — из шаблонов организации. Раньше подписи групп
  // были захардкожены, и два разных журнала («sanitation_day_control» и
  // «sanitary_day_control») получали одну и ту же подпись «САН. ДЕНЬ» —
  // в списке шли две неразличимые группы.
  const templates =
    candidateCodes.length > 0
      ? await db.journalTemplate.findMany({
          where: { code: { in: candidateCodes } },
          select: { code: true, name: true },
        })
      : [];
  const templateName = new Map(templates.map((t) => [t.code, t.name.trim()]));
  const journalName = (code: string): string =>
    // Короткая подпись из словаря — первой: полное название журнала
    // («Журнал контроля температурного режима холодильного и морозильного
    // оборудования») в заголовке группы на телефоне не помещается.
    JOURNAL_LABELS[code] || templateName.get(code) || code;

  if (allowedCodes.length > 0) {
    // Day-window для batch claims-query — по дню организации.
    const dayStart = today;
    const dayEnd = tomorrow;

    const [pools, allClaimsRaw] = await Promise.all([
      Promise.all(
        allowedCodes.map((code) =>
          generatePoolForDay({ organizationId, journalCode: code, date: today })
        )
      ),
      db.journalTaskClaim.findMany({
        where: {
          organizationId,
          journalCode: { in: allowedCodes },
          dateKey: { gte: dayStart, lt: dayEnd },
        },
        include: { user: { select: { name: true } } },
        orderBy: { claimedAt: "asc" },
      }),
    ]);

    // Группируем claims по journalCode → ClaimRow[]
    const claimsByCode = new Map<string, ClaimRow[]>();
    for (const c of allClaimsRaw) {
      const list = claimsByCode.get(c.journalCode) ?? [];
      list.push({
        id: c.id,
        organizationId: c.organizationId,
        journalCode: c.journalCode,
        scopeKey: c.scopeKey,
        scopeLabel: c.scopeLabel,
        dateKey: c.dateKey,
        userId: c.userId,
        userName: c.user?.name,
        status: c.status as ClaimRow["status"],
        claimedAt: c.claimedAt,
        completedAt: c.completedAt,
        releasedAt: c.releasedAt,
        parentHint: c.parentHint,
        entryId: c.entryId,
        tasksFlowTaskId: c.tasksFlowTaskId,
      });
      claimsByCode.set(c.journalCode, list);
    }

    for (let i = 0; i < allowedCodes.length; i++) {
      const code = allowedCodes[i];
      const pool = pools[i];
      if (!pool.pool || pool.scopes.length === 0) continue;
      const claims = claimsByCode.get(code) ?? [];
      const claimByScope = new Map<
        string,
        { active?: ClaimRow; completed?: ClaimRow }
      >();
      for (const c of claims) {
        const b = claimByScope.get(c.scopeKey) ?? {};
        if (c.status === "active") b.active = c;
        if (c.status === "completed") b.completed = c;
        claimByScope.set(c.scopeKey, b);
      }
      const label = journalName(code);
      const enriched: EnrichedScope[] = pool.scopes.map((s) => {
        const b = claimByScope.get(s.scopeKey) ?? {};
        let availability: EnrichedScope["availability"] = "available";
        let claimUserName: string | null | undefined;
        let claimId: string | undefined;
        if (b.completed) {
          availability = "completed";
          claimUserName = b.completed.userName;
          claimId = b.completed.id;
        } else if (b.active) {
          availability = b.active.userId === userId ? "mine" : "taken";
          claimUserName = b.active.userName;
          claimId = b.active.id;
        }
        return {
          ...s,
          // Название документа бывает служебным («Проверка health_check»),
          // и оно уезжало в подпись задачи как есть.
          sublabel: s.sublabel
            ? looksLikeJournalCode(s.sublabel)
              ? label
              : s.sublabel
            : undefined,
          journalCode: code,
          journalLabel: label,
          iconName: journalIconName(code),
          availability,
          claimUserName,
          claimId,
        };
      });
      groups.push({ code, label, scopes: enriched });
    }
  }

  // Больничный / отпуск / выходной из «Графика смен». Сотрудник его не
  // видел вовсе: отметку ставила управляющая, а в приложении ничего не
  // менялось. Задачи при этом НЕ прячем — человек может выйти на подмену.
  const shift = await db.workShift.findFirst({
    where: { organizationId, userId, date: { gte: today, lt: tomorrow } },
    select: { status: true },
  });
  const scheduleStatus =
    shift && shift.status !== "scheduled" ? shift.status : null;

  return NextResponse.json({
    dateKey,
    groups,
    scheduleStatus,
    myActive: myActiveToday
      ? {
          id: myActiveToday.id,
          journalCode: myActiveToday.journalCode,
          scopeKey: myActiveToday.scopeKey,
          scopeLabel: myActiveToday.scopeLabel,
          verificationStatus: myActiveToday.verificationStatus,
          verifierComment: myActiveToday.verifierComment,
        }
      : null,
    // Зависшие задачи прошлых дней. Автозакрытия нет намеренно — решение
    // владельца; человек сам доделывает или возвращает их в общий список.
    stuckClaims: stuckClaims.map((c) => ({
      id: c.id,
      scopeLabel: c.scopeLabel,
      journalCode: c.journalCode,
      dateKey: c.dateKey.toISOString().slice(0, 10),
    })),
  });
}
