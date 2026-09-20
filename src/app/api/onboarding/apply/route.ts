import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import {
  computeAutoJournalCodes,
  computeDisabledJournalCodes,
  getDemoStaffForType,
  getOnboardingPreset,
  type OrgType,
} from "@/lib/onboarding-presets";
import { recordAuditLog } from "@/lib/audit-log";
import { sphereToPreset } from "@/lib/org-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/onboarding/apply
 *
 * Применяет «онбординг-пресет» к текущей организации:
 *   1. Создаёт канонические должности под `Organization.type` (или явный `type`).
 *   2. Заполняет `JobPositionJournalAccess` — кто за что отвечает.
 *   3. Если `seedDemoStaff: true` — добавляет демо-сотрудников
 *      (1-2 человека на должность с `+7990…` телефонами).
 *
 * Идемпотентно: повторный вызов не задвоит должности (upsert по unique
 * `organizationId+categoryKey+name`) и не задвоит сотрудников (skip
 * по unique `organizationId+phone` или `organizationId+fullName`).
 *
 * Body:
 *   {
 *     type?: "restaurant" | "meat" | ...      // default = org.type
 *     seedDemoStaff?: boolean                  // default false
 *     applyJournalAccess?: boolean             // default true
 *   }
 *
 * Доступ: только management.
 */
const bodySchema = z.object({
  type: z
    .enum(["restaurant", "meat", "dairy", "bakery", "confectionery", "other"])
    .optional(),
  seedDemoStaff: z.boolean().optional(),
  applyJournalAccess: z.boolean().optional(),
  /** Если true — переписать Organization.type на новое значение из body.type
      (после визарда «у нас не ресторан, а пекарня»). По умолчанию false:
      preset применяется, тип организации не трогаем. */
  updateOrgType: z.boolean().optional(),
  /** Если true — записать computeDisabledJournalCodes(preset) в
      Organization.disabledJournalCodes. По умолчанию true для нового
      онбординга — клиент видит только relevant журналы. */
  applyDisabledJournals: z.boolean().optional(),
  /** Если true — записать computeAutoJournalCodes(preset) в
      Organization.autoJournalCodes. Cron auto-journals потом сам
      создаст документы на текущий месяц. По умолчанию true. */
  applyAutoJournals: z.boolean().optional(),
});

export async function POST(request: Request) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);

  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message ?? "Bad body" }, { status: 400 });
  }

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, type: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  }

  const type = (body.data.type ?? org.type) as OrgType;
  const preset = getOnboardingPreset(sphereToPreset(type));
  const applyJournals = body.data.applyJournalAccess ?? true;
  const seedStaff = body.data.seedDemoStaff ?? false;
  // По умолчанию пресет должностей больше НЕ трогает набор журналов.
  // Раньше «Применить пресет» затирал `disabledJournalCodes`, отменяя и
  // ручные тумблеры, и набор по сфере — три системы писали в одно поле
  // и переигрывали друг друга. Пресет — про должности.
  const applyDisabledJournals = body.data.applyDisabledJournals ?? false;
  const applyAutoJournals = body.data.applyAutoJournals ?? true;
  const updateOrgType = body.data.updateOrgType ?? false;

  // 0. Optionally update org-level fields from preset: type, disabled
  // journals (so dashboard isn't cluttered with 35 cards), auto-journals
  // (so cron creates monthly documents without admin intervention).
  const orgUpdate: Record<string, unknown> = {};
  if (updateOrgType && body.data.type && body.data.type !== org.type) {
    orgUpdate.type = body.data.type;
  }
  if (applyDisabledJournals) {
    orgUpdate.disabledJournalCodes = computeDisabledJournalCodes(preset);
  }
  if (applyAutoJournals) {
    orgUpdate.autoJournalCodes = computeAutoJournalCodes(preset);
  }
  if (Object.keys(orgUpdate).length > 0) {
    await db.organization.update({
      where: { id: organizationId },
      data: orgUpdate,
    });
  }

  // 1. upsert positions
  const positionByName = new Map<string, string>();
  let sortOrder = 0;
  for (const pos of preset.positions) {
    const created = await db.jobPosition.upsert({
      where: {
        organizationId_categoryKey_name: {
          organizationId,
          categoryKey: pos.category,
          name: pos.name,
        },
      },
      create: {
        organizationId,
        categoryKey: pos.category,
        name: pos.name,
        sortOrder: sortOrder++,
      },
      update: {},
      select: { id: true },
    });
    positionByName.set(pos.name, created.id);
  }

  // 2. apply JobPositionJournalAccess
  let journalRowsCreated = 0;
  if (applyJournals) {
    const allCodes = Array.from(
      new Set(preset.positions.flatMap((p) => p.journalCodes))
    );
    const templates = await db.journalTemplate.findMany({
      where: { code: { in: allCodes } },
      select: { id: true, code: true },
    });
    const templateIdByCode = new Map(templates.map((t) => [t.code, t.id]));

    for (const pos of preset.positions) {
      const positionId = positionByName.get(pos.name);
      if (!positionId) continue;
      const ids = pos.journalCodes
        .map((c) => templateIdByCode.get(c))
        .filter((id): id is string => Boolean(id));

      // delete-then-create — простейший «sync» паттерн
      await db.jobPositionJournalAccess.deleteMany({
        where: { jobPositionId: positionId, organizationId },
      });
      if (ids.length > 0) {
        await db.jobPositionJournalAccess.createMany({
          data: ids.map((templateId) => ({
            organizationId,
            jobPositionId: positionId,
            templateId,
          })),
          skipDuplicates: true,
        });
        journalRowsCreated += ids.length;
      }
    }
  }

  // 3. seed demo staff (skip duplicates by phone)
  let staffCreated = 0;
  let staffSkipped = 0;
  if (seedStaff) {
    const demo = getDemoStaffForType(type);
    for (const s of demo) {
      const positionId = positionByName.get(s.positionName);
      if (!positionId) {
        staffSkipped++;
        continue;
      }
      const existing = await db.user.findFirst({
        where: { organizationId, phone: s.phone },
        select: { id: true },
      });
      if (existing) {
        staffSkipped++;
        continue;
      }
      await db.user.create({
        data: {
          organizationId,
          name: s.fullName,
          email: `demo+${s.phone.replace(/\D/g, "")}@wesetup.ru`,
          passwordHash: "",
          role: "cook",
          phone: s.phone,
          jobPositionId: positionId,
          isActive: false, // демо — не активируем для логина
        },
      });
      staffCreated++;
    }
  }

  await recordAuditLog({
    request,
    session,
    organizationId,
    action: "onboarding.apply-preset",
    entity: "Organization",
    entityId: organizationId,
    details: {
      type,
      presetLabel: preset.label,
      positionsCreated: positionByName.size,
      journalAccessRowsCreated: journalRowsCreated,
      staffCreated,
      staffSkipped,
      seedStaffRequested: seedStaff,
      orgUpdated: orgUpdate,
    },
  });

  return NextResponse.json({
    ok: true,
    type,
    presetLabel: preset.label,
    positionsCreated: positionByName.size,
    journalAccessRowsCreated: journalRowsCreated,
    staffCreated,
    staffSkipped,
    orgUpdated: orgUpdate,
  });
}
