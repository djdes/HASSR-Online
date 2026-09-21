import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { miniAttachmentRateLimiter } from "@/lib/rate-limit";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import crypto from "crypto";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];
// Расширение берём ОТ mime-type, не от имени файла. Иначе можно
// загрузить shell.php с jpeg-контентом — на disk сохранится .php.
// На текущем prod-сетапе nginx PHP не выполняет, но defense-in-depth.
const EXT_BY_TYPE: Record<AllowedType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  // Per-user disk-fill protection: 60 загрузок в день. Без этого один
  // авторизованный сотрудник мог бы pump'ить 5MB-файлы и забить
  // public/uploads. Quota щедрая для нормальной работы (повар обычно
  // 5-15 photo-evidence/смену), но обрезает abuse.
  if (!miniAttachmentRateLimiter.consume(session.user.id)) {
    return NextResponse.json(
      {
        error:
          "Превышен дневной лимит загрузок (60). Попробуйте завтра или обратитесь к менеджеру.",
      },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const entryId = form.get("entryId") as string | null;

    // Тексты — по-русски и на «вы»: их видит повар на телефоне, а не
    // разработчик в консоли.
    if (!file) {
      return NextResponse.json({ error: "Файл не выбран" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type as AllowedType)) {
      return NextResponse.json(
        { error: "Подойдут JPG, PNG или WebP" },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "Фото больше 5 МБ — сожмите или снимите заново" },
        { status: 400 }
      );
    }

    // Multi-tenant scope: если entryId указан — он должен принадлежать
    // активной организации юзера. Иначе IDOR: cross-tenant attach,
    // плюс при несуществующем entryId Prisma бросает FK error → 500
    // вместо понятного 404.
    if (entryId) {
      const entry = await db.journalEntry.findFirst({
        where: { id: entryId, organizationId: getActiveOrgId(session) },
        select: { id: true },
      });
      if (!entry) {
        return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
      }
    }

    const ext = EXT_BY_TYPE[file.type as AllowedType];
    const hash = crypto.randomBytes(8).toString("hex");
    const filename = `${hash}.${ext}`;
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uploadDir = join(process.cwd(), "public", "uploads");
    // На свежей выкладке каталога `public/uploads` может не быть — без него
    // `writeFile` падал, фото не прикладывалось, и задачу с обязательным
    // фото нельзя было завершить.
    await mkdir(uploadDir, { recursive: true });
    const filepath = join(uploadDir, filename);
    await writeFile(filepath, buffer);

    const url = `/uploads/${filename}`;

    // Save metadata to DB if entryId provided
    let attachmentId: string | undefined;
    if (entryId) {
      const rec = await db.journalEntryAttachment.create({
        data: {
          entryId,
          url,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          uploadedById: session.user.id,
        },
      });
      attachmentId = rec.id;
    }

    await logAudit({
      organizationId: getActiveOrgId(session) ?? "",
      userId: session.user.id,
      userName: session.user.name ?? undefined,
      action: "attachment.upload",
      entity: "journal_entry_attachment",
      entityId: attachmentId,
      details: { entryId, filename: file.name, size: file.size },
    });

    return NextResponse.json({ url, filename: file.name, size: file.size });
  } catch (err) {
    console.error("[mini/attachments] upload error:", err);
    return NextResponse.json(
      { error: "Не удалось загрузить фото. Попробуйте ещё раз." },
      { status: 500 }
    );
  }
}
