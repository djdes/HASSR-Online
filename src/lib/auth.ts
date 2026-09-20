import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { clientIpFromHeaderBag } from "@/lib/client-ip";
import { recordLogin } from "@/lib/login-trace";
import { getSessionVersion, isSessionVersionCurrent } from "@/lib/session-version";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getPermissionRole } from "@/lib/user-roles";
import { verifyTelegramInitData } from "@/lib/telegram-init-data";
import { telegramSignInMessageFor } from "@/lib/telegram-auth-messages";

/** User-Agent из мешка заголовков NextAuth (настоящего Request здесь нет). */
function userAgentFromHeaderBag(headers: unknown): string | null {
  if (!headers || typeof headers !== "object") return null;
  const value = (headers as Record<string, unknown>)["user-agent"];
  return typeof value === "string" ? value : null;
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 365 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  jwt: {
    maxAge: 365 * 24 * 60 * 60,
  },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-haccp-online.session-token"
          : "haccp-online.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 365 * 24 * 60 * 60,
        secure: process.env.NODE_ENV === "production",
      },
    },
    csrfToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Host-haccp-online.csrf-token"
          : "haccp-online.csrf-token",
      options: {
        httpOnly: false,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    callbackUrl: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-haccp-online.callback-url"
          : "haccp-online.callback-url",
      options: {
        httpOnly: false,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Введите email и пароль");
        }

        // Защита от brute-force: 5 попыток на email за 5 минут.
        // Lazy-import — rate-limit Map не должна быть в server bundle
        // если функция не вызвана.
        const { loginRateLimiter } = await import("@/lib/rate-limit");
        const emailKey = `login:${credentials.email.toLowerCase().trim()}`;
        if (!loginRateLimiter.consume(emailKey)) {
          throw new Error(
            "Слишком много попыток входа. Подождите 5 минут или восстановите пароль."
          );
        }

        const user = await db.user.findUnique({
          where: { email: credentials.email },
          include: { organization: true },
        });

        // Anti-enumeration: всегда делаем bcrypt.compare, даже если
        // юзер не найден или неактивен. Иначе атакующий замеряет
        // timing — отсутствующий email отвечает за <5 ms, существующий
        // ~100 ms — и enumerate'ит реестр email'ов через NextAuth-провайдер.
        // То же поведение, что в /api/auth/login (которое уже было
        // hardened DUMMY_BCRYPT_HASH'ом).
        const DUMMY_BCRYPT_HASH =
          "$2a$10$CwTycUXWue0Thq9StjUM0uJ8.lllkbczy3.0qVxgApY/I5p9mElqS";
        const passwordHashToCheck = user?.passwordHash ?? DUMMY_BCRYPT_HASH;
        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          passwordHashToCheck
        );

        if (!user || !user.isActive || !isPasswordValid) {
          throw new Error("Неверный email или пароль");
        }

        // Отметка о входе для /root/metrics. NextAuth не даёт сюда
        // настоящий Request — только мешок заголовков от адаптера.
        await recordLogin(user.id, clientIpFromHeaderBag(req?.headers), {
          userAgent: userAgentFromHeaderBag(req?.headers),
          method: "password",
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: getPermissionRole(user.role),
          organizationId: user.organizationId,
          organizationName: user.organization.name,
          isRoot: user.isRoot === true,
          permissionPreset: user.permissionPreset ?? null,
        };
      },
    }),
    // Second CredentialsProvider: Telegram Mini App sign-in. The client sends
    // the raw `window.Telegram.WebApp.initData` string as the sole credential;
    // we verify its HMAC against TELEGRAM_BOT_TOKEN and map the TG user id to
    // an existing User via `telegramChatId`. No auto-provisioning — the bot's
    // `/start inv_<token>` handler is the only place that binds new users.
    CredentialsProvider({
      id: "telegram",
      name: "Telegram",
      credentials: {
        initData: { label: "initData", type: "text" },
      },
      async authorize(credentials, req) {
        const initData = credentials?.initData;
        if (!initData) {
          throw new Error("Не найдены данные Telegram");
        }
        const verified = verifyTelegramInitData(initData);
        if (!verified.ok) {
          // Разные причины — разные действия человека. Просроченная
          // подпись (приложение висело открытым больше суток) лечится
          // повторным открытием из бота, а не кнопкой «ещё раз»;
          // несошедшаяся подпись — тем же самым, но текст другой.
          throw new Error(telegramSignInMessageFor(verified.error));
        }
        const chatIdStr = String(verified.data.user.id);
        // Сбой базы не должен долетать до экрана входа как есть: next-auth
        // отдаёт текст исключения клиенту, и человек видел сырое
        // «Invalid `db.user.findFirst()` invocation…» вместо объяснения.
        const user = await db.user
          .findFirst({
            where: { telegramChatId: chatIdStr, isActive: true },
            include: { organization: true },
          })
          .catch((error: unknown) => {
            console.error("[auth:telegram] user lookup failed", error);
            throw new Error(
              "Не удалось проверить вход — сервис временно недоступен. Попробуйте ещё раз через минуту."
            );
          });
        if (!user) {
          throw new Error(
            "Аккаунт не связан с Telegram. Получите приглашение у руководителя."
          );
        }
        await recordLogin(user.id, clientIpFromHeaderBag(req?.headers), {
          userAgent: userAgentFromHeaderBag(req?.headers),
          method: "telegram",
        });
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: getPermissionRole(user.role),
          organizationId: user.organizationId,
          organizationName: user.organization.name,
          isRoot: user.isRoot === true,
          permissionPreset: user.permissionPreset ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        const u = user as {
          id: string;
          role: string;
          organizationId: string;
          organizationName: string;
          isRoot?: boolean;
          permissionPreset?: string | null;
        };
        token.id = u.id;
        token.role = u.role;
        token.organizationId = u.organizationId;
        token.organizationName = u.organizationName;
        token.isRoot = u.isRoot === true;
        token.permissionPreset = u.permissionPreset ?? null;
        token.actingAsOrganizationId = null;
        // Организация, в которой человек работал в прошлый раз. Членство
        // проверяем при переключении (POST /api/me/active-organization),
        // а здесь — при входе: доступ могли отозвать, пока он был офлайн.
        token.activeOrganizationId = await resolveActiveOrganizationId(
          u.id,
          u.organizationId,
        );
        token.sv = await getSessionVersion(u.id);
      }
      // Переключение между своими организациями пишет claim напрямую в
      // cookie (см. lib/session-token.ts) — здесь только подхватываем.
      if (trigger === "update" && session && typeof session === "object") {
        if ("activeOrganizationId" in session) {
          const next = session.activeOrganizationId;
          token.activeOrganizationId =
            typeof next === "string" && next.length > 0 ? next : null;
        }
        if ("partnerAccess" in session) {
          const { parsePartnerAccessClaim } = await import(
            "@/lib/partners/access-guard"
          );
          token.partnerAccess = parsePartnerAccessClaim(session.partnerAccess);
        }
      }
      // Impersonation: root clicks "View as <org>" or "Stop" and the
      // client calls `update({ actingAsOrganizationId: ... })`. NextAuth v4
      // routes that through the jwt callback with trigger === "update".
      if (trigger === "update" && session && typeof session === "object") {
        if ("actingAsOrganizationId" in session && token.isRoot) {
          const next = session.actingAsOrganizationId;
          token.actingAsOrganizationId =
            typeof next === "string" && next.length > 0 ? next : null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      // «Завершить все сессии»: токен старой версии больше не сессия.
      // null — клиент (useSession) считает себя разлогиненным.
      if (!(await isSessionVersionCurrent(String(token.id ?? token.sub ?? ""), token.sv))) {
        return null as unknown as typeof session;
      }
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.organizationId = token.organizationId as string;
        session.user.organizationName = token.organizationName as string;
        session.user.isRoot = token.isRoot === true;
        session.user.permissionPreset =
          typeof token.permissionPreset === "string" ? token.permissionPreset : null;
        session.user.actingAsOrganizationId =
          typeof token.actingAsOrganizationId === "string"
            ? token.actingAsOrganizationId
            : null;
        session.user.activeOrganizationId =
          typeof token.activeOrganizationId === "string"
            ? token.activeOrganizationId
            : null;
        session.user.partnerAccess = null;
        session.user.orgPresetOverrides = null;

        // Live-refresh organizationName + permissionPreset из БД. JWT
        // кэширует на момент login и больше не обновляется, поэтому
        // переименование org или смена preset'а админом «прилипает» к
        // юзеру до релогина. Один запрос (org + user fields) решает.
        try {
          const { db } = await import("@/lib/db");
          // Членство перепроверяем на КАЖДОМ запросе, а не только при
          // логине: доступ к соседней точке могли отозвать минуту назад,
          // а cookie с claim'ом живёт неделями. Не сошлось — молча
          // возвращаем человека в домашнюю организацию.
          if (
            session.user.activeOrganizationId &&
            session.user.activeOrganizationId !== session.user.organizationId
          ) {
            const membership = await db.organizationMember.findUnique({
              where: {
                userId_organizationId: {
                  userId: session.user.id,
                  organizationId: session.user.activeOrganizationId,
                },
              },
              select: { role: true },
            });
            if (!membership) {
              // Не член — возможно, это партнёр, открывший кабинет
              // клиента. Привязку и уровень перечитываем из БД на каждый
              // запрос: клиент мог отвязать консультанта минуту назад.
              const { parsePartnerAccessClaim } = await import(
                "@/lib/partners/access-guard"
              );
              const { resolvePartnerSessionAccess } = await import(
                "@/lib/partners/session-access"
              );
              const claim = parsePartnerAccessClaim(token.partnerAccess);
              const partnerAccess =
                claim && claim.organizationId === session.user.activeOrganizationId
                  ? await resolvePartnerSessionAccess(session.user.id, claim)
                  : null;
              if (partnerAccess) {
                session.user.partnerAccess = partnerAccess;
                session.user.role = "owner";
              } else {
                session.user.activeOrganizationId = null;
              }
            } else {
              // Права в чужой организации берём из членства, а не из
              // домашней роли: и владелец сети, и приглашённый
              // руководитель работают там как руководство. В сессии
              // роль руководителя называется "owner"
              // (см. getPermissionRole в lib/user-roles.ts).
              session.user.role = "owner";
            }
          }
          const activeOrgId =
            session.user.isRoot &&
            typeof session.user.actingAsOrganizationId === "string" &&
            session.user.actingAsOrganizationId.length > 0
              ? session.user.actingAsOrganizationId
              : session.user.activeOrganizationId ||
                session.user.organizationId;
          if (activeOrgId) {
            const fresh = await db.organization.findUnique({
              where: { id: activeOrgId },
              select: { name: true, presetCapabilitiesJson: true },
            });
            if (fresh?.name) {
              session.user.organizationName = fresh.name;
            }
            session.user.orgPresetOverrides =
              fresh?.presetCapabilitiesJson &&
              typeof fresh.presetCapabilitiesJson === "object" &&
              !Array.isArray(fresh.presetCapabilitiesJson)
                ? (fresh.presetCapabilitiesJson as Record<string, string[]>)
                : null;
          } else {
            session.user.orgPresetOverrides = null;
          }
          if (session.user.id) {
            const freshUser = await db.user.findUnique({
              where: { id: session.user.id },
              select: { permissionPreset: true },
            });
            if (freshUser) {
              session.user.permissionPreset = freshUser.permissionPreset ?? null;
            }
          }
          // В кабинете клиента партнёр видит всё как руководитель;
          // запись при level=view режут middleware и getServerSession.
          if (session.user.partnerAccess) {
            session.user.permissionPreset = "admin";
          }
        } catch {
          /* fall back to cached token values */
        }
      }
      return session;
    },
  },
  events: {
    /**
     * Уведомление руководству при первом входе нового сотрудника.
     * Дедупликация через AuditLog (action="user.first_login") — повторные
     * логины не пингают повторно. Fire-and-forget: ошибка нотификации
     * не должна ломать сам логин.
     */
    async signIn({ user }) {
      const u = user as { id?: string; organizationId?: string; name?: string };
      if (!u?.id || !u.organizationId) return;
      try {
        const { db } = await import("@/lib/db");
        const existing = await db.auditLog.findFirst({
          where: {
            organizationId: u.organizationId,
            action: "user.first_login",
            entityId: u.id,
          },
          select: { id: true },
        });
        if (existing) return;

        await db.auditLog.create({
          data: {
            organizationId: u.organizationId,
            userId: u.id,
            userName: u.name ?? null,
            action: "user.first_login",
            entity: "user",
            entityId: u.id,
          },
        });

        // Не пингаем для root и management — они себя сами регистрируют
        // и не интересны как «новенький».
        const { notifyOrganization, escapeTelegramHtml: esc } = await import(
          "@/lib/telegram"
        );
        const { isManagementRole } = await import("@/lib/user-roles");
        const u2 = user as { role?: string; isRoot?: boolean };
        if (u2?.isRoot || isManagementRole(u2?.role)) return;

        const message =
          `👋 <b>Новенький в команде</b>\n\n` +
          `${esc(u.name ?? "Сотрудник")} зашёл в систему первый раз. ` +
          `Проверьте права доступа и медкнижку, прежде чем выпускать на смену.`;
        await notifyOrganization(u.organizationId, message, ["owner"]);
      } catch (err) {
        console.warn("[auth/signIn] first-login notify failed", err);
      }
    },
  },
};

/**
 * Какая организация должна стать активной при входе.
 *
 * Берём последнюю, где человек работал, но только если членство ещё в
 * силе: доступ могли отозвать, пока он был офлайн, и тогда он обязан
 * вернуться в свою домашнюю организацию, а не в чужую.
 */
async function resolveActiveOrganizationId(
  userId: string,
  homeOrganizationId: string,
): Promise<string> {
  try {
    const { db } = await import("@/lib/db");
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { lastActiveOrganizationId: true },
    });
    const last = user?.lastActiveOrganizationId;
    if (!last || last === homeOrganizationId) return homeOrganizationId;
    const member = await db.organizationMember.findUnique({
      where: {
        userId_organizationId: { userId, organizationId: last },
      },
      select: { id: true },
    });
    return member ? last : homeOrganizationId;
  } catch {
    return homeOrganizationId;
  }
}
