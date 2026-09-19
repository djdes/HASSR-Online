import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db";
import { sessionEmployeeForQr } from "@/lib/qr-fill-actor";
import {
  JOURNAL_FILL_HUB_CODE,
  listFillEmployees,
  listHubJournals,
  listJournalFillDocuments,
  loadOrganizationForFill,
  normalizeQrFillMode,
  todayKeyFor,
  verifyJournalFillToken,
} from "@/lib/journal-fill";
import { JournalFillClient } from "./journal-fill-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { robots: { index: false, follow: false } };

/**
 * Публичная страница QR-ввода в журнал: плакат → сотрудник → строка →
 * форма адаптера → запись. Без сессии в режимах public/pin; в режиме
 * auth — только для вошедших (страница входа возвращает сюда через `next`).
 */
export default async function JournalFillPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; code: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { orgId, code } = await params;
  const { token } = await searchParams;
  if (!token) notFound();

  const check = verifyJournalFillToken(token, orgId, code);
  const org = check.ok ? await loadOrganizationForFill(orgId) : null;
  if (!check.ok || !org) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fafbff] px-4 py-10">
        <div className="w-full max-w-md rounded-3xl border border-[#ececf4] bg-white p-8 text-center shadow-[0_20px_60px_-30px_rgba(11,16,36,0.2)]">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#fff4f2] text-2xl text-[#a13a32]">!</div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">Ссылка недействительна</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">Плакат повреждён или не подходит к этой организации.</p>
        </div>
      </main>
    );
  }

  const mode = normalizeQrFillMode(org.qrFillMode);
  const todayKey = todayKeyFor(org.timezone);
  const disabledCodes = org.disabledJournalCodes as string[];

  // Режим «через вход»: без сессии — на страницу входа и обратно сюда.
  let sessionEmployee: { id: string; name: string; positionTitle: string | null; canPickOthers: boolean } | null = null;
  if (mode === "auth") {
    const returnTo = `/journal-fill/${orgId}/${code}?token=${encodeURIComponent(token)}`;
    const resolved = await sessionEmployeeForQr(orgId);
    if (!resolved.ok && resolved.reason === "no-session") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    if (!resolved.ok) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-[#fafbff] px-4 py-10">
          <div className="w-full max-w-md rounded-3xl border border-[#ececf4] bg-white p-8 text-center shadow-[0_20px_60px_-30px_rgba(11,16,36,0.2)]">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">Плакат другой организации</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">Вы вошли под аккаунтом, который не принадлежит «{org.name}». Выйдите и войдите под своим сотрудником этой организации.</p>
          </div>
        </main>
      );
    }
    sessionEmployee = resolved.employee;
  }

  const isHub = code === JOURNAL_FILL_HUB_CODE;
  const [journals, documents, employees, template] = await Promise.all([
    isHub ? listHubJournals(orgId, disabledCodes, todayKey) : Promise.resolve([]),
    isHub ? Promise.resolve([]) : listJournalFillDocuments(orgId, code, todayKey),
    mode === "auth" && sessionEmployee && !sessionEmployee.canPickOthers
      ? Promise.resolve([{ id: sessionEmployee.id, name: sessionEmployee.name, positionTitle: sessionEmployee.positionTitle }])
      : listFillEmployees(orgId),
    isHub ? Promise.resolve(null) : db.journalTemplate.findFirst({ where: { code }, select: { name: true } }),
  ]);
  if (!isHub && !template) notFound();

  return (
    <JournalFillClient
      token={token}
      orgId={orgId}
      orgName={org.name}
      code={code}
      journalName={template?.name ?? "Все журналы"}
      isHub={isHub}
      hubJournals={journals}
      mode={mode}
      sessionEmployee={sessionEmployee}
      documents={check.documentId ? documents.filter((doc) => doc.id === check.documentId) : documents}
      employees={employees}
      todayKey={todayKey}
      journalDisabled={!isHub && disabledCodes.includes(code)}
    />
  );
}
