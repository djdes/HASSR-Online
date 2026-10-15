import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import crypto from "crypto";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { verifyTaskFillToken } from "@/lib/task-fill-token";
import { extractEmployeeId } from "@/lib/tasksflow-adapters/row-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];
const EXT_BY_TYPE: Record<AllowedType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Photo upload для pipeline-step в task-fill. Работает БЕЗ NextAuth
 * сессии — auth через HMAC-token в multipart-формате (worker никогда
 * не логинился в WeSetup, у него только TasksFlow-ссылка).
 *
 *   POST /api/task-fill/<taskId>/photo
 *   FormData: file=<image>, token=<hmac>, stepId=<id>, stepIndex=<n>
 *   Returns: { ok: true, url: "/uploads/<hash>.jpg" }
 *
 * URL фото возвращается клиенту — он включит его в pipeline-trail
 * при финальном submit. AuditLog тоже фиксирует факт загрузки.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  const { taskId: taskIdRaw } = await ctx.params;
  const taskId = Number(taskIdRaw);
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ errorCode: "badTaskId", error: "Bad taskId" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { errorCode: "multipartRequired", error: "Multipart-форма ожидается" },
      { status: 400 }
    );
  }

  const token = form.get("token");
  const file = form.get("file");
  const stepId = form.get("stepId");
  const stepIndex = form.get("stepIndex");
  if (
    typeof token !== "string" ||
    !(file instanceof File) ||
    typeof stepId !== "string" ||
    typeof stepIndex !== "string"
  ) {
    return NextResponse.json(
      { errorCode: "photoFieldsMissing", error: "Не хватает полей (file/token/stepId/stepIndex)" },
      { status: 400 }
    );
  }

  if (!ALLOWED_TYPES.includes(file.type as AllowedType)) {
    return NextResponse.json(
      { errorCode: "photoType", error: "Допустимы JPG / PNG / WebP" },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { errorCode: "photoSize", error: "Файл больше 5 МБ" },
      { status: 400 }
    );
  }

  // HMAC verify — как в основном route'е.
  const candidates = await db.tasksFlowTaskLink.findMany({
    where: { tasksflowTaskId: taskId },
    include: { integration: true },
  });
  if (candidates.length === 0) {
    return NextResponse.json({ errorCode: "taskNotFound", error: "Task not found" }, { status: 404 });
  }
  let link: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    const v = verifyTaskFillToken(token, c.integration.webhookSecret);
    if (!v.ok) continue;
    if (v.taskId !== taskId) continue;
    link = c;
    break;
  }
  if (!link) {
    return NextResponse.json({ errorCode: "invalidToken", error: "Invalid token" }, { status: 401 });
  }

  const ext = EXT_BY_TYPE[file.type as AllowedType];
  const hash = crypto.randomBytes(8).toString("hex");
  const filename = `task-${taskId}-${stepId}-${hash}.${ext}`;
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const uploadDir = join(process.cwd(), "public", "uploads");
  const filepath = join(uploadDir, filename);
  try {
    // mkdir recursive — на свежем deploy папки `public/uploads` может не
    // быть (next build её не создаёт сам). Раньше юзер видел «Не
    // удалось сохранить файл» с ENOENT в логах. recursive: true идемпотентно
    // и быстро (<1ms если уже существует).
    await mkdir(uploadDir, { recursive: true });
    await writeFile(filepath, buffer);
  } catch (err) {
    console.error("[task-fill/photo] write failed", err);
    return NextResponse.json(
      { errorCode: "photoSave", error: "Не удалось сохранить файл" },
      { status: 500 }
    );
  }
  const url = `/uploads/${filename}`;

  // Audit-log: упоминание факта загрузки. Сам шаг будет подтверждён
  // отдельным POST /step после возврата url'а сюда.
  const employeeId = extractEmployeeId(link.rowKey);
  let employeeName: string | null = null;
  if (employeeId) {
    const emp = await db.user.findUnique({
      where: { id: employeeId },
      select: { name: true },
    });
    employeeName = emp?.name ?? null;
  }
  await recordAuditLog({
    request,
    session: employeeId
      ? { user: { id: employeeId, name: employeeName } }
      : null,
    organizationId: link.integration.organizationId,
    action: "journal.fill.photo",
    entity: "journal_task",
    entityId: String(taskId),
    details: {
      taskId,
      journalCode: link.journalCode,
      stepId,
      stepIndex: Number(stepIndex) || 0,
      url,
      sizeBytes: file.size,
      mime: file.type,
    },
  });

  return NextResponse.json({ ok: true, url });
}
