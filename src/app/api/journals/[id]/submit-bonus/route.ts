import { readFile } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { extractPhotoTakenAt, isPhotoFresh } from "@/lib/exif";

/**
 * POST /api/journals/[id]/submit-bonus
 *
 * Phase 3 → шаги 3.4 + 3.7. Финализирует премиальный obligation:
 * создаёт JournalEntry + прикреплённый JournalEntryAttachment, помечает
 * obligation `status='done'`, и проставляет `BonusEntry.photoUrl`.
 *
 * Anti-fraud (3.7): сервер сам читает EXIF из файла на диске. Если
 * `photoTakenAt` в пределах 5 минут от now — `BonusEntry.status =
 * "approved"` сразу. Иначе submit отклоняется (400). Менеджер
 * по-прежнему может отозвать одобренную премию через `/bonuses` (3.5).
 *
 * Только тот, кто забрал премию (`obligation.claimedById === user.id`)
 * может вызвать этот endpoint. Все остальные попадают в 403.
 */

const PHOTO_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

const PHOTO_URL_PATTERN = /^\/uploads\/[a-zA-Z0-9._-]{1,128}$/;

const submitBonusSchema = z.object({
  photoUrl: z
    .string()
    .min(1)
    .regex(PHOTO_URL_PATTERN, "photoUrl должен быть из /uploads/"),
  notes: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;

  const session = auth.session;
  const orgId = getActiveOrgId(session);
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Некорректный JSON" },
      { status: 400 }
    );
  }

  const parsed = submitBonusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ошибка валидации" },
      { status: 400 }
    );
  }

  const obligation = await db.journalObligation.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      templateId: true,
      claimedById: true,
      status: true,
      template: {
        select: {
          id: true,
          bonusAmountKopecks: true,
        },
      },
    },
  });

  if (!obligation || obligation.organizationId !== orgId) {
    return NextResponse.json(
      { error: "Обязательство не найдено" },
      { status: 404 }
    );
  }

  if (obligation.template.bonusAmountKopecks <= 0) {
    return NextResponse.json(
      { error: "Это не премиальный журнал" },
      { status: 400 }
    );
  }

  if (obligation.claimedById !== userId) {
    return NextResponse.json(
      {
        error:
          obligation.claimedById === null
            ? "Сначала возьмите эту задачу в списке «Сегодня»"
            : "Премию забрал другой сотрудник",
      },
      { status: 403 }
    );
  }

  if (obligation.status === "done") {
    return NextResponse.json(
      { error: "Обязательство уже выполнено" },
      { status: 409 }
    );
  }

  const filename = parsed.data.photoUrl.split("/").pop() ?? "photo.jpg";
  const now = new Date();
  const notes = parsed.data.notes;

  // 3.7 — серверная EXIF-проверка. Файл лежит в `public/uploads/<hash>.<ext>`,
  // куда писал `/api/mini/attachments`. Читаем сами, чтобы клиент не мог
  // подменить `photoTakenAt`.
  let photoTakenAt: Date | null = null;
  let fileBuffer: Buffer;
  try {
    const filepath = join(process.cwd(), "public", parsed.data.photoUrl);
    fileBuffer = await readFile(filepath);
  } catch (err) {
    console.error("[submit-bonus] read uploaded file failed", err);
    return NextResponse.json(
      { error: "Не удалось прочитать загруженное фото" },
      { status: 400 }
    );
  }
  photoTakenAt = extractPhotoTakenAt(fileBuffer);

  if (
    !isPhotoFresh(photoTakenAt, now, PHOTO_FRESHNESS_WINDOW_MS)
  ) {
    console.warn("[submit-bonus] EXIF freshness check failed", {
      obligationId: obligation.id,
      userId,
      photoTakenAt: photoTakenAt?.toISOString() ?? null,
      nowIso: now.toISOString(),
    });
    return NextResponse.json(
      {
        // На «вы», как и остальные сообщения сервера.
        error:
          photoTakenAt === null
            ? "В этом фото нет времени съёмки — снимите новое прямо на месте. Снимок из галереи не подойдёт"
            : "Фото снято слишком давно — нужен свежий снимок, не старше 5 минут",
        photoTakenAt: photoTakenAt?.toISOString() ?? null,
      },
      { status: 400 }
    );
  }

  const result = await db.$transaction(async (tx) => {
    const entry = await tx.journalEntry.create({
      data: {
        templateId: obligation.template.id,
        organizationId: orgId,
        filledById: userId,
        data: ({
          _bonus: true,
          notes: notes ?? "",
        }) as Prisma.InputJsonValue,
        status: "submitted",
      },
    });

    await tx.journalEntryAttachment.create({
      data: {
        entryId: entry.id,
        url: parsed.data.photoUrl,
        filename,
        mimeType: "image/jpeg",
        sizeBytes: fileBuffer.byteLength,
        uploadedById: userId,
      },
    });

    await tx.journalObligation.update({
      where: { id: obligation.id },
      data: { status: "done", completedAt: now },
    });

    await tx.bonusEntry.update({
      where: { obligationId: obligation.id },
      data: {
        photoUrl: parsed.data.photoUrl,
        photoTakenAt,
        status: "approved",
      },
    });

    return entry;
  });

  return NextResponse.json(
    {
      entryId: result.id,
      photoUrl: parsed.data.photoUrl,
      photoTakenAt: photoTakenAt?.toISOString() ?? null,
      bonusStatus: "approved" as const,
    },
    { status: 201 }
  );
}
