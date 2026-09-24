import { notFound } from "next/navigation";

import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { findOrderTemplate } from "@/lib/orders/catalog";
import {
  currentOrgSnapshot,
  getOrder,
  listOrders,
  suggestNextNumber,
} from "@/lib/orders/store";
import { defaultOrderValues } from "@/lib/orders/render";
import { OrderEditor } from "./order-editor";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const template = findOrderTemplate(code);
  return { title: template ? template.title : "Приказ" };
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

  const [org, existing, orders] = await Promise.all([
    currentOrgSnapshot(organizationId),
    existingId ? getOrder(organizationId, existingId) : Promise.resolve(null),
    listOrders(organizationId),
  ]);

  // Реквизиты берём из снимка приказа, если он уже издан: директор мог
  // смениться, а под старым приказом должна остаться прежняя подпись.
  const snapshot = existing?.org ?? org;

  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <OrderEditor
      template={template}
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
      initialValues={defaultOrderValues(template, today)}
      returnTo={returnTo}
    />
  );
}
