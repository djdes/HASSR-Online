import { NextResponse } from "next/server";
import { z } from "zod";

import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";
import { generateLinkToken } from "@/lib/telegram";
import {
  verifyTelegramContactResponse,
  verifyTelegramInitData,
} from "@/lib/telegram-init-data";
import { linkTelegramToAuthenticatedUser } from "@/lib/telegram-phone-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postBodySchema = z.object({
  initData: z.string().min(1),
  contactResponse: z.string().min(1).optional(),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { telegramChatId: true, phone: true },
  });

  const botUsername =
    process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || null;
  const botLinkUrl = botUsername
    ? `https://t.me/${botUsername}?start=${generateLinkToken(session.user.id)}`
    : null;

  return NextResponse.json({
    telegramLinked: Boolean(user?.telegramChatId),
    phone: user?.phone ?? null,
    botUsername,
    botLinkUrl,
  });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = postBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, status: "invalid_payload" },
      { status: 400 }
    );
  }

  const verifiedInit = verifyTelegramInitData(parsed.data.initData);
  if (!verifiedInit.ok) {
    return NextResponse.json(
      { ok: false, errorCode: verifiedInit.error },
      { status: 401 }
    );
  }

  let verifiedPhone: string | undefined;
  if (parsed.data.contactResponse) {
    const verifiedContact = verifyTelegramContactResponse(
      parsed.data.contactResponse
    );
    if (!verifiedContact.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: "invalid_contact",
          errorCode: verifiedContact.error,
        },
        { status: 400 }
      );
    }
    if (verifiedContact.data.contact.user_id !== verifiedInit.data.user.id) {
      return NextResponse.json(
        { ok: false, status: "contact_mismatch" },
        { status: 403 }
      );
    }
    verifiedPhone = verifiedContact.data.contact.phone_number;
  }

  const result = await linkTelegramToAuthenticatedUser({
    userId: session.user.id,
    chatId: String(verifiedInit.data.user.id),
    verifiedPhone,
  });

  if (!result.ok) {
    const statusCode = result.status === "not_found" ? 404 : 409;
    return NextResponse.json(
      { ok: false, status: result.status },
      { status: statusCode }
    );
  }

  return NextResponse.json({
    ok: true,
    status: result.status,
    phoneSaved: result.phoneSaved ?? null,
  });
}
