import { notFound, redirect } from "next/navigation";
import { isPointScoped } from "@/lib/point-scope";
import { getTranslations } from "next-intl/server";

import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { findOrderTemplate } from "@/lib/orders/catalog";
import { toOrderOrgSnapshot } from "@/lib/document-org-block";
import { loadDocumentOrgBlock } from "@/lib/document-org-block.server";
import {
  getOrder,
  listOrders,
  suggestNextNumber,
} from "@/lib/orders/store";
import { defaultOrderValues } from "@/lib/orders/render";
import { db } from "@/lib/db";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { buildHaccpTeamOrderValues } from "@/lib/ppk/team-order";
import type { TeamMember } from "@/lib/ppk/records";
import { OrderEditor } from "./order-editor";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const template = findOrderTemplate(code);
  const t = await getTranslations("ordersUi");
  return { title: template ? template.title : t("orderPage.title") };
}

/**
 * Заполнение приказа: форма слева, живой лист справа.
 *
 * Предпросмотр рисуется тем же текстом, что уйдёт в печать, поэтому
 * человек видит результат до того, как потратит бумагу. Сам лист —
 * обычный HTML с `print:`-правилами, а не iframe с PDF: печать из
 * браузера даёт тот же вид и не требует ждать серверный рендер.
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  const query = await searchParams;

  const template = findOrderTemplate(code);
  if (!template) notFound();

  const session = await requireAuth();
  // Приказы компании — руководителю точки закрыты (2026-11-01), как и в proxy.
  if (isPointScoped(session.user)) redirect("/dashboard");
  const organizationId = getActiveOrgId(session);
  const canManage = hasFullWorkspaceAccess(session.user);

  const existingId = typeof query.id === "string" ? query.id : null;
  // Пришли из фазы «Документы» быстрого старта — после сохранения вернём
  // туда же. Адрес возврата фиксированный: из query его не берём, чтобы
  // ссылкой нельзя было увести человека на чужой сайт.
  const returnTo =
    query.from === "onboarding" && canManage
      ? "/settings/onboarding#documents"
      : null;

  const [block, existing, orders] = await Promise.all([
    loadDocumentOrgBlock(organizationId),
    existingId ? getOrder(organizationId, existingId) : Promise.resolve(null),
    listOrders(organizationId),
  ]);

  // Реквизиты берём из снимка приказа, если он уже издан: директор мог
  // смениться, а под старым приказом должна остаться прежняя подпись.
  // Логотип и фирменный цвет — текущие (это оформление, а не реквизиты).
  const org = block ? toOrderOrgSnapshot(block) : null;
  const snapshot = existing?.org ?? org;
  const brand = block?.brand ?? null;

  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Из блока «Группа ХАССП»: руководитель и состав подставляются в приказ.
  const defaults = defaultOrderValues(template, today);
  let initialValues = defaults;
  let preferInitial = false;
  if (query.prefill === "ppk-team" && template.code === "haccp-team" && canManage && !existing) {
    const [rows, staff] = await Promise.all([
      db.ppkRecord.findMany({
        where: { organizationId, block: "team" },
        select: { data: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      loadPpkStaff(organizationId),
    ]);
    if (rows.length > 0) {
      initialValues = {
        ...defaults,
        ...buildHaccpTeamOrderValues(
          rows.map((row) => row.data as unknown as TeamMember),
          staff,
        ),
      };
      preferInitial = true;
    }
  }

  return (
    <OrderEditor
      template={template}
      brand={brand}
      org={
        snapshot ?? {
          orgName: "",
          orgShortName: "",
          orgInn: null,
          orgAddress: null,
          directorName: null,
          directorPost: null,
          city: null,
        }
      }
      canManage={canManage}
      existing={
        existing
          ? {
              id: existing.id,
              number: existing.number,
              issuedAt: existing.issuedAt.toISOString().slice(0, 10),
              values: existing.values,
            }
          : null
      }
      initialNumber={suggestNextNumber(orders)}
      initialIssuedAt={todayIso}
      initialValues={initialValues}
      preferInitial={preferInitial}
      returnTo={returnTo}
    />
  );
}
