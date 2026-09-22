import { QrPageShell } from "@/components/qr-fill/qr-page-shell";
import { resolvePersonalLoginToken } from "@/lib/personal-login";

import { PersonalQrLogin } from "./personal-qr-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Вход по личному QR", robots: { index: false, follow: false } };

/**
 * Личный QR-вход (2026-09-22): карточка с QR у сотрудника (обычно у
 * заведующей). Скан → имя → свой PIN → кабинет со всеми разделами, что ему
 * положены (с «Разрешением менять настройки» — как у руководителя).
 */
export default async function PersonalQrPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolvePersonalLoginToken(token);
  if (!resolved) {
    return (
      <QrPageShell orgName="WeSetup" title="Вход по личному QR">
        <div className="rounded-3xl border border-[#ececf4] bg-white p-6 text-center">
          <h2 className="text-[20px] font-semibold text-[#0b1024]">QR больше не действует</h2>
          <p className="mt-2 text-[16px] leading-relaxed text-[#6f7282]">
            Руководитель выпустил новый или отключил этот. Попросите новый QR в «Сотрудники → карточка → Личный QR».
          </p>
        </div>
      </QrPageShell>
    );
  }
  return (
    <QrPageShell orgName={resolved.user.organization.name} title="Вход в кабинет">
      <PersonalQrLogin token={token} name={resolved.user.name} hasPin={Boolean(resolved.user.qrPinHash)} />
    </QrPageShell>
  );
}
