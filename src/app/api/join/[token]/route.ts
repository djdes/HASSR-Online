import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { hashInviteToken } from "@/lib/invite-tokens";
import { ensurePlanForHeadcount } from "@/lib/plan-limits.server";
import { checkSeatsForActivation, seatLimitResponse } from "@/lib/billing.server";
import { resolveJournalAccessBootstrap } from "@/lib/staff-journal-bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public endpoint — обслуживает форму саморегистрации сотрудника по
 * QR-коду. Никакого auth: вся защита через проверку токена.
 *
 * GET /api/join/[token]
 *   200 → { organizationName, positions: [{id,name,categoryKey}] }
 *   404 → токен не найден или истёк
 *   410 → уже использован
 *
 * POST /api/join/[token]
 *   Body: { fullName, phone, jobPositionId, password }
 *   200 → { ok: true, userId, email }
 *   404/410 → как у GET
 *   409 → телефон уже занят
 *   400 → валидация
 */

async function resolveValidToken(rawToken: string) {
  const tokenHash = hashInviteToken(rawToken);
  const row = await db.employeeJoinToken.findUnique({ where: { tokenHash } });
  if (!row) return { kind: "not_found" as const };
  if (row.expiresAt.getTime() <= Date.now()) return { kind: "not_found" as const };
  if (row.claimedAt) return { kind: "already_claimed" as const };
  return { kind: "ok" as const, row };
}

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const r = await resolveValidToken(token);
  if (r.kind === "not_found") {
    return NextResponse.json(
      { error: "Ссылка не найдена или истекла" },
      { status: 404 }
    );
  }
  if (r.kind === "already_claimed") {
    return NextResponse.json(
      { error: "Эта ссылка уже использована" },
      { status: 410 }
    );
  }

  const [org, positions] = await Promise.all([
    db.organization.findUnique({
      where: { id: r.row.organizationId },
      select: { name: true },
    }),
    db.jobPosition.findMany({
      // Сторонняя бракеражная комиссия в штат по QR не записывается.
      where: { organizationId: r.row.organizationId, categoryKey: { not: "commission" } },
      orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }],
      select: { id: true, name: true, categoryKey: true },
    }),
  ]);

  return NextResponse.json({
    organizationName: org?.name ?? "Организация",
    positions,
    suggestedJobPositionId: r.row.suggestedJobPositionId,
  });
}

const ClaimSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "ФИО слишком короткое")
    .max(120, "ФИО слишком длинное"),
  phone: z
    .string()
    .trim()
    .regex(/^\+?\d[\d\s\-()]{6,20}$/, "Телефон в неверном формате"),
  jobPositionId: z.string().min(1, "Выберите должность"),
  password: z
    .string()
    .min(8, "Пароль не короче 8 символов")
    .max(120, "Пароль слишком длинный"),
});

function normalizePhone(input: string): string {
  // Убираем всё кроме цифр, форсируем 7 в начале (РФ).
  const digits = input.replace(/\D+/g, "");
  if (digits.startsWith("8") && digits.length === 11) return "+7" + digits.slice(1);
  if (digits.startsWith("7") && digits.length === 11) return "+" + digits;
  if (digits.length === 10) return "+7" + digits;
  return "+" + digits;
}

function deriveRoleFromCategory(categoryKey: string): string {
  // management должности → role=manager (имеют full workspace access)
  // staff должности → role=cook (универсальная staff-роль; обработка
  // конкретных привилегий идёт через JobPositionJournalAccess по
  // должности, не по role).
  return categoryKey === "management" ? "manager" : "cook";
}

export async function POST(request: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const r = await resolveValidToken(token);
  if (r.kind === "not_found") {
    return NextResponse.json(
      { error: "Ссылка не найдена или истекла" },
      { status: 404 }
    );
  }
  if (r.kind === "already_claimed") {
    return NextResponse.json(
      { error: "Эта ссылка уже использована" },
      { status: 410 }
    );
  }

  let body: z.infer<typeof ClaimSchema>;
  try {
    body = ClaimSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad input" },
        { status: 400 }
      );
    }
    throw err;
  }

  // Должность должна принадлежать той же org что и токен.
  const position = await db.jobPosition.findFirst({
    where: { id: body.jobPositionId, organizationId: r.row.organizationId, categoryKey: { not: "commission" } },
    select: { id: true, name: true, categoryKey: true },
  });
  if (!position) {
    return NextResponse.json(
      { error: "Должность не найдена в этой организации" },
      { status: 400 }
    );
  }

  // Лимит тарифа — до создания. Самозаписывается сотрудник: оплачивать
  // не ему, поэтому текст — «попросите руководителя».
  const seats = await checkSeatsForActivation(r.row.organizationId, 1, {
    source: "join.qr",
    audience: "invitee",
  });
  if (!seats.ok) return seatLimitResponse(seats);

  const phone = normalizePhone(body.phone);

  // Уникальность по phone в рамках организации (телефон — natural key
  // для линковки с TasksFlow).
  const phoneTaken = await db.user.findFirst({
    where: { organizationId: r.row.organizationId, phone, archivedAt: null },
    select: { id: true },
  });
  if (phoneTaken) {
    return NextResponse.json(
      { error: "Сотрудник с таким телефоном уже зарегистрирован" },
      { status: 409 }
    );
  }

  // Email — synthetic (telephone-based), чтобы соблюсти @unique constraint
  // и не запрашивать его на форме (не у всех сотрудников вообще есть email).
  // Если в будущем admin захочет настоящий email — добавит через UI.
  //
  // Домен — ПОЛНЫЙ id организации. Раньше брали первые 8 символов: у cuid
  // это общий для всех записей префикс (одна и та же временная метка), и
  // две разные компании с одинаковым номером сотрудника упирались в
  // `User.email @unique` — наружу летела голая 500.
  const synthEmailLocal = phone.replace(/\D+/g, "");
  const orgSlug = r.row.organizationId.toLowerCase().replace(/[^a-z0-9]/g, "");
  const email = `${synthEmailLocal}@${orgSlug}.staff.local`;

  const passwordHash = await bcrypt.hash(body.password, 10);

  const role = deriveRoleFromCategory(position.categoryKey);

  // Журналы должности → UserJournalAccess: `hasJournalAccess` читает
  // только его, а не JobPositionJournalAccess.
  //
  // Если у должности журналы НЕ настроены (а по умолчанию это так),
  // строгий режим не включаем — иначе сотрудник получал пустой ACL и не
  // видел вообще ничего. Правило общее с «Сотрудниками», см.
  // `resolveJournalAccessBootstrap`.
  const positionTemplates = await db.jobPositionJournalAccess.findMany({
    where: {
      organizationId: r.row.organizationId,
      jobPositionId: position.id,
    },
    include: { template: { select: { code: true } } },
  });
  const accessBootstrap = resolveJournalAccessBootstrap(
    positionTemplates.map((t) => t.template.code)
  );

  // Создаём User + UserJournalAccess + помечаем токен использованным
  // в одной транзакции.
  let newUser: { id: string; name: string };
  try {
    newUser = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email,
          name: body.fullName.trim(),
          phone,
          passwordHash,
          role,
          organizationId: r.row.organizationId,
          jobPositionId: position.id,
          positionTitle: position.name,
          isActive: true,
          journalAccessMigrated: accessBootstrap.journalAccessMigrated,
        },
      });
      if (accessBootstrap.grantedTemplateCodes.length > 0) {
        await tx.userJournalAccess.createMany({
          data: accessBootstrap.grantedTemplateCodes.map((templateCode) => ({
            userId: u.id,
            templateCode,
            canRead: true,
            canWrite: true,
            canFinalize: false,
          })),
          skipDuplicates: true,
        });
      }
      await tx.employeeJoinToken.update({
        where: { id: r.row.id },
        data: { claimedAt: new Date(), claimedUserId: u.id },
      });
      await tx.auditLog.create({
        data: {
          organizationId: r.row.organizationId,
          userId: u.id,
          userName: u.name,
          action: "employee.self_registered",
          entity: "User",
          entityId: u.id,
          details: {
            via: "qr_join_token",
            joinTokenId: r.row.id,
            positionName: position.name,
            journalsGranted: accessBootstrap.grantedTemplateCodes.length,
          },
        },
      });
      return u;
    });
  } catch (err) {
    // P2002 — уникальный индекс. Практически всегда это email, собранный
    // из телефона: тот же номер уже заводили в этой компании (например,
    // сотрудник архивирован и поэтому не попал в проверку выше).
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Сотрудник с таким телефоном уже зарегистрирован в этой компании" },
        { status: 409 }
      );
    }
    throw err;
  }

  // До конца бесплатного периода самозапись по QR тоже может перевести
  // организацию на подписку (тихо, как раньше).
  await ensurePlanForHeadcount(r.row.organizationId);

  // Auto-onboarding в TasksFlow:
  //   1. Создаём worker в TF по телефону + ФИО + должности (если
  //      интеграция enabled). Даже если пользователь уже есть в TF
  //      по этому номеру — listUsers() при следующем sync найдёт
  //      совпадение, ошибки «уже есть» проглатываем.
  //   2. Триггерим bulk-assign-today через server-to-server fetch с
  //      x-internal-trigger header — назначаем все сегодняшние задачи
  //      по журналам должности.
  // Всё in-fly: ответ юзеру не ждёт TF, иначе при медленном TF API
  // регистрация будет 5-10 секунд "висеть".
  void autoOnboardToTasksflow({
    organizationId: r.row.organizationId,
    wesetupUserId: newUser.id,
    name: newUser.name,
    phone,
    positionName: position.name,
    request,
  });

  return NextResponse.json({ ok: true, userId: newUser.id, email });
}

async function autoOnboardToTasksflow(args: {
  organizationId: string;
  wesetupUserId: string;
  name: string;
  phone: string;
  positionName: string;
  request: Request;
}) {
  try {
    const integration = await db.tasksFlowIntegration.findUnique({
      where: { organizationId: args.organizationId },
      select: { id: true, baseUrl: true, apiKeyEncrypted: true, enabled: true },
    });
    if (!integration || !integration.enabled) return;

    const { tasksflowClientFor, normalizeRussianPhone, TasksFlowError } =
      await import("@/lib/tasksflow-client");
    const client = tasksflowClientFor(integration);
    const normalized = normalizeRussianPhone(args.phone) ?? args.phone;

    // 1. Если worker с таким телефоном уже есть — берём его, иначе
    //    создаём. createUser в TF идемпотентен по телефону: если уже
    //    есть, вернёт существующего (либо 409 — обрабатываем).
    let remote: { id: number; workerId: number; phone: string } | null = null;
    try {
      const created = await client.createUser({
        phone: normalized,
        name: args.name,
        position: args.positionName,
      });
      // TF возвращает TasksFlowUser без отдельного workerId — у обычного
      // юзера user.id и есть worker.id (admin исключение, но мы сюда
      // только не-admin'ов отправляем).
      remote = {
        id: created.id,
        workerId: created.id,
        phone: created.phone,
      };
    } catch (err) {
      if (err instanceof TasksFlowError && (err.status === 409 || err.status === 400)) {
        // Уже существует — найдём через listUsers.
        try {
          const list = await client.listUsers();
          const hit = list.find(
            (u) => normalizeRussianPhone(u.phone) === normalized
          );
          if (hit) {
            remote = { id: hit.id, workerId: hit.id, phone: hit.phone };
          }
        } catch (e) {
          console.warn("[join/auto-onboard] listUsers failed", e);
        }
      } else {
        console.warn("[join/auto-onboard] createUser failed", err);
      }
    }

    if (remote) {
      await db.tasksFlowUserLink.upsert({
        where: {
          integrationId_wesetupUserId: {
            integrationId: integration.id,
            wesetupUserId: args.wesetupUserId,
          },
        },
        create: {
          integrationId: integration.id,
          wesetupUserId: args.wesetupUserId,
          phone: normalized,
          tasksflowUserId: remote.id,
          tasksflowWorkerId: remote.workerId,
          source: "auto",
        },
        update: {
          phone: normalized,
          tasksflowUserId: remote.id,
          tasksflowWorkerId: remote.workerId,
        },
      });
    }

    // 2. Триггерим bulk-assign-today через internal cookie-less путь.
    //    Передаём x-internal-trigger header + organizationId в body —
    //    endpoint проверит секрет и обойдёт session-проверку.
    const secret = process.env.INTERNAL_TRIGGER_SECRET;
    if (!secret) {
      console.warn("[join/auto-onboard] INTERNAL_TRIGGER_SECRET не задан — skip auto fan-out");
      return;
    }
    // НЕ берём базу из args.request.url — Host-header под контролем
    // атакующего: сети с прокси (FastPanel/Nginx) пробрасывают `Host`
    // как-есть, и `request.url` собирается из него. POST-ом на
    // /api/join/<token> с `Host: evil.com` мы бы отдали секретный
    // x-internal-trigger ключ на attacker-controlled URL. Используем
    // NEXTAUTH_URL — он жёстко задан в env прода.
    const baseUrl = process.env.NEXTAUTH_URL;
    if (!baseUrl) {
      console.warn("[join/auto-onboard] NEXTAUTH_URL не задан — skip auto fan-out");
      return;
    }
    const url = new URL("/api/integrations/tasksflow/bulk-assign-today", baseUrl);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-trigger": secret,
      },
      body: JSON.stringify({ organizationId: args.organizationId }),
    });
    if (!res.ok) {
      console.warn(
        "[join/auto-onboard] bulk-assign-today failed",
        res.status,
        await res.text().catch(() => "")
      );
    }
  } catch (e) {
    console.warn("[join/auto-onboard] uncaught", e);
  }
}
