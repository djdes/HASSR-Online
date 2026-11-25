import { NextResponse } from "next/server";
import { z } from "zod";

import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import { issueSession } from "@/lib/issue-session";
import { recordLogin } from "@/lib/login-trace";
import { resolveMiniRole } from "@/lib/mini-role";
import { getUserPermissions } from "@/lib/permissions-server";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  verifyTelegramContactResponse,
  verifyTelegramInitData,
} from "@/lib/telegram-init-data";
import { linkTelegramByVerifiedPhone } from "@/lib/telegram-phone-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const linkTelegramPhoneRateLimiter = createRateLimiter({
  tokensPerInterval: 10,
  intervalMs: 5 * 60 * 1000,
});

const requestBodySchema = z.object({
  initData: z.string().min(1),
  contactResponse: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const ip = clientIp(request) ?? "unknown";
    const rlKey = `mini-link-tg-phone:${ip}`;
    if (!linkTelegramPhoneRateLimiter.consume(rlKey)) {
      return NextResponse.json(
        {
          ok: false,
          status: "rate_limited",
          error: "Слишком много попыток. Подождите 5 минут.",
        },
        { status: 429 }
      );
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = requestBodySchema.safeParse(rawBody);
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

    const chatId = String(verifiedInit.data.user.id);

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

      const result = await linkTelegramByVerifiedPhone({
        chatId,
        rawPhone: verifiedContact.data.contact.phone_number,
      });

      if (!result.ok) {
        const statusCode =
          result.status === "invalid_phone"
            ? 400
            : result.status === "not_found"
              ? 404
              : 409;
        return NextResponse.json(
          { ok: false, status: result.status },
          { status: statusCode }
        );
      }

      await recordLogin(result.user.id, ip === "unknown" ? null : ip, {
        userAgent: request.headers.get("user-agent"),
        method: "telegram",
      });

      const perms = await getUserPermissions(result.user.id);
      const resolved = resolveMiniRole(
        {
          role: result.user.role,
          isRoot: result.user.isRoot,
          permissionPreset: result.user.permissionPreset,
        },
        perms
      );

      linkTelegramPhoneRateLimiter.refund(rlKey);
      return issueSession(
        NextResponse.json({
          ok: true,
          status: result.status,
          roleKind: resolved.kind,
          roleGroup: resolved.group,
          homeHref: resolved.homeHref,
        }),
        result.user,
        result.user.organization.name
      );
    }

    // Fallback for older Telegram clients where requestContact() sends the
    // phone to the bot (`message:contact`) instead of returning a signed response.
    const user = await db.user.findFirst({
      where: {
        telegramChatId: chatId,
        isActive: true,
        archivedAt: null,
      },
      include: { organization: true },
    });

    if (!user) {
      return NextResponse.json(
        { ok: false, status: "pending_bot_contact" },
        { status: 202 }
      );
    }

    await recordLogin(user.id, ip === "unknown" ? null : ip, {
      userAgent: request.headers.get("user-agent"),
      method: "telegram",
    });

    const perms = await getUserPermissions(user.id);
    const resolved = resolveMiniRole(
      {
        role: user.role,
        isRoot: user.isRoot,
        permissionPreset: user.permissionPreset,
      },
      perms
    );

    linkTelegramPhoneRateLimiter.refund(rlKey);
    return issueSession(
      NextResponse.json({
        ok: true,
        status: "already_linked",
        roleKind: resolved.kind,
        roleGroup: resolved.group,
        homeHref: resolved.homeHref,
      }),
      user,
      user.organization.name
    );
  } catch (error) {
    console.error("[mini-link-telegram-phone]", error);
    return NextResponse.json(
      { ok: false, error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
