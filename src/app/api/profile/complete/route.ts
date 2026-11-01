import { NextResponse } from "next/server";
import { normalizeSphere, sphereLabel } from "@/lib/org-profile";
import { composeProfileCompletedAlert } from "@/lib/lead-alerts";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { escapeTelegramHtml } from "@/lib/telegram";
import { defaultDisabledCodesFor } from "@/lib/sphere-journal-rules";
import { isUntouchedDisabledCodes } from "@/lib/health-check-default-off";
import bcrypt from "bcryptjs";
import { requireAuth, getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { isPointScoped } from "@/lib/point-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { sendPasswordChangedEmail } from "@/lib/email";
import { innDigits, isValidInn } from "@/lib/inn";
import { checkPointsForCreation } from "@/lib/billing.server";
import { ensureLocationBuildings, MAX_AUTO_LOCATIONS } from "@/lib/location-buildings";
import { refreshOrganizationLegalProfile } from "@/lib/org-legal-profile";
import { normalizePhone } from "@/lib/phone";
import { registrationConfirmRateLimiter } from "@/lib/rate-limit";
import {
  DEFAULT_OWNER_POSITION,
  OWNER_POSITION_CATEGORY,
} from "@/lib/sphere-positions";
import { completeProfileSchema } from "@/lib/validators";
import { resolveLocale } from "@/i18n/locales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Анкета после мгновенной регистрации: данные организации и контакты.
 *
 * Подтверждения почты здесь больше нет. Раньше «Готово» не работало,
 * пока человек не закажет код и не перепечатает его из письма, — это
 * ещё один шаг между регистрацией и первым журналом, и на нём люди
 * отваливались. Почта подтверждается отдельно в настройках
 * (/api/settings/email-verify), и ничего не блокирует.
 *
 * Телефон обязателен: без него не работает авто-связка сотрудника с
 * TasksFlow, которая ищет человека по номеру.
 */
export async function POST(request: Request) {
  const session = await requireAuth();
  // Анкета переписывает организацию целиком (название, сфера, ИНН, точки)
  // — её заполняет руководство всей компании, те же условия, что у показа
  // анкеты в кабинете (аудит 2026-11-01: повар или руководитель точки
  // переименовывали компанию и стирали ИНН прямым запросом).
  if (
    !hasFullWorkspaceAccess(session.user) ||
    isPointScoped(session.user) ||
    isImpersonating(session) ||
    session.user.partnerAccess ||
    session.user.isRoot === true
  ) {
    return NextResponse.json(
      { error: "Анкету компании заполняет руководство компании" },
      { status: 403 },
    );
  }
  const email = session.user.email;
  if (!email) {
    return NextResponse.json(
      { error: "У аккаунта не указана почта" },
      { status: 400 },
    );
  }

  if (!registrationConfirmRateLimiter.consume(`complete:${session.user.id}`)) {
    return NextResponse.json(
      { error: "Слишком много попыток. Подождите несколько минут" },
      { status: 429 },
    );
  }

  const parsed = completeProfileSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректный запрос" },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const phone = normalizePhone(data.phone);
  if (!phone) {
    return NextResponse.json(
      { error: "Укажите телефон в формате +7XXXXXXXXXX" },
      { status: 400 },
    );
  }

  const organizationId = getActiveOrgId(session);
  const passwordHash = data.newPassword
    ? await bcrypt.hash(data.newPassword, 12)
    : null;

  // Имя необязательное: если его не назвали, подставляем название
  // организации. Оставлять почту в поле имени нельзя — она протекает
  // в шапку кабинета и в подписи под записями журналов.
  const displayName = data.name?.trim() || data.organizationName;

  // Набор журналов по сфере. Пишем только если организация ещё не
  // трогала список руками: пустой `disabledJournalCodes` (или только
  // журнал здоровья, который мы выключаем сами при регистрации) —
  // состояние сразу после регистрации. Если человек уже что-то
  // выключал, его выбор важнее нашего дефолта.
  const current = await db.organization.findUnique({
    where: { id: organizationId },
    select: { disabledJournalCodes: true },
  });
  const untouchedJournals = isUntouchedDisabledCodes(
    Array.isArray(current?.disabledJournalCodes)
      ? (current.disabledJournalCodes as string[])
      : null
  );

  // «Оформить меня сотрудником»: владелец уже есть в команде, но без
  // должности — он висит в /settings/users безымянной строкой. Ставим ему
  // должность из управленческого каталога, заводя её при необходимости.
  const positionName = data.asEmployee
    ? data.positionName?.trim() || DEFAULT_OWNER_POSITION
    : null;

  await db.$transaction(async (tx) => {
    let jobPositionId: string | null = null;
    if (positionName) {
      const existing = await tx.jobPosition.findUnique({
        where: {
          organizationId_categoryKey_name: {
            organizationId,
            categoryKey: OWNER_POSITION_CATEGORY,
            name: positionName,
          },
        },
        select: { id: true },
      });
      if (existing) {
        jobPositionId = existing.id;
      } else {
        const last = await tx.jobPosition.findFirst({
          where: { organizationId },
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true },
        });
        const created = await tx.jobPosition.create({
          data: {
            organizationId,
            categoryKey: OWNER_POSITION_CATEGORY,
            name: positionName,
            sortOrder: (last?.sortOrder ?? 0) + 1,
          },
          select: { id: true },
        });
        jobPositionId = created.id;
      }
    }

    await tx.organization.update({
      where: { id: organizationId },
      data: {
        name: data.organizationName,
        type: data.sphere,
        ownershipKind: data.ownershipKind,
        locationsCount: data.locationsCount,
        inn: data.inn?.trim() || null,
        // Адрес приходит из ЕГРЮЛ вместе с ИНН; пустой не затирает то,
        // что могло быть введено в настройках раньше.
        ...(data.address?.trim() ? { address: data.address.trim() } : {}),
        ...(untouchedJournals
          ? { disabledJournalCodes: defaultDisabledCodesFor(normalizeSphere(data.sphere)) }
          : {}),
      },
    });
    await tx.user.update({
      where: { id: session.user.id },
      data: {
        name: displayName,
        phone,
        ...(passwordHash ? { passwordHash } : {}),
        // positionTitle дублируем: легаси-экраны читают его, а не связь.
        ...(jobPositionId && positionName
          ? { jobPositionId, positionTitle: positionName }
          : {}),
      },
    });
  });

  // Точки: «Точек» ≥ 2 → заводим здания-точки и включаем раздельные
  // журналы. Одна точка — обычная организация, ничего не создаём. Точек
  // больше, чем оплачено, анкета не заводит (лимит тарифа — как у
  // POST /api/settings/buildings): добавить их можно после смены тарифа.
  if (data.locationsCount >= 2) {
    const buildingsNow = await db.building.count({ where: { organizationId } });
    const adding = Math.min(data.locationsCount, MAX_AUTO_LOCATIONS) - Math.max(1, buildingsNow);
    const points = await checkPointsForCreation(organizationId, adding, { source: "profile/complete" });
    if (points.ok) {
      await ensureLocationBuildings(organizationId, data.locationsCount, {
        firstAddress: data.address?.trim() || null,
      }).catch((error) => {
        console.error("[profile/complete] ensureLocationBuildings failed", error);
      });
    }
  }

  // Снимок ЕГРЮЛ по ИНН — реквизиты, руководитель, ОКВЭД, численность —
  // в организацию; показывается в /settings/organization. Ошибки DaData
  // анкету не ломают.
  const inn = innDigits(data.inn);
  if (isValidInn(inn)) {
    await refreshOrganizationLegalProfile(organizationId, inn);
  }

  // Анкета подставляет пароль сама, и пароль из письма о регистрации после
  // сохранения не подходит. Новый дублируем на почту — не дожидаясь
  // отправки, как и при регистрации.
  if (data.newPassword) {
    sendPasswordChangedEmail({
      to: email,
      password: data.newPassword,
      organizationId,
      locale: resolveLocale({ authenticated: true, userLocale: session.user.locale, organizationLocale: session.user.organizationLocale }),
    }).catch((err) => console.error("sendPasswordChangedEmail failed", err));
  }

  // Анкета с телефоном — самый тёплый момент: человек сейчас в кабинете, и
  // звонок «помочь с первым QR» в ближайшие минуты попадает в цель. Один раз
  // на организацию (dedupeKey); сбой Telegram анкету не ломает.
  notifyPlatformAdmin(
    composeProfileCompletedAlert({
      organizationName: data.organizationName,
      sphereLabel: sphereLabel(data.sphere),
      locationsCount: data.locationsCount,
      name: displayName,
      phone,
      email,
      escape: escapeTelegramHtml,
    }),
    { kind: "profile_completed", dedupeKey: `profile_completed:${organizationId}` },
  ).catch((error) => console.error("[profile/complete] admin alert failed", error));

  // Точки: анкета показывает шаг «Назовите точки» — отдаём созданные.
  const buildings =
    data.locationsCount >= 2
      ? await db.building.findMany({
          where: { organizationId },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: { id: true, name: true, address: true },
        })
      : [];
  return NextResponse.json({ ok: true, buildings });
}
