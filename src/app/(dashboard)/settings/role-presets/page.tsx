import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import {
  ALL_CAPABILITIES,
  CAPABILITY_LABELS,
  getDefaultCapabilities,
  hasCapability,
  listAllPresets,
} from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { RolePresetsClient } from "@/components/settings/role-presets-client";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function RolePresetsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!hasCapability(session.user, "admin.full")) redirect("/journals");

  const orgId = getActiveOrgId(session);
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { presetCapabilitiesJson: true },
  });
  const initialOverrides =
    org?.presetCapabilitiesJson &&
    typeof org.presetCapabilitiesJson === "object" &&
    !Array.isArray(org.presetCapabilitiesJson)
      ? (org.presetCapabilitiesJson as Record<string, string[]>)
      : null;

  const presets = listAllPresets().map((p) => ({
    ...p,
    defaults: getDefaultCapabilities(p.value),
  }));
  // Списки пресетов и возможностей — из permission-presets.ts, как в API.
  const capabilityKeys = [...ALL_CAPABILITIES];

  return (
    <div className="space-y-5">
      {/* Тёмный hero снят: сразу под заголовком идёт важное предупреждение
          про head_chef и сама таблица пресетов — их и нужно видеть первыми.
          Переход в «Сотрудники» вынесен в действие справа, чтобы не
          прятать его внутри абзаца. */}
      <PageHeader
        title="Наборы прав по ролям"
        description="Что видит каждая роль на сайте и в Telegram-боте. Назначить пресет конкретному сотруднику можно в «Сотрудниках»."
        actions={
          <Link
            href="/settings/users"
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            Сотрудники
          </Link>
        }
      />

      <div className="rounded-3xl border border-[#ffe9b0] bg-[#fff8eb] p-4 text-[13px] text-[#a13a32]">
        <strong>Заведующий производством (head_chef)</strong> по умолчанию НЕ имеет
        capability <code className="rounded bg-white/50 px-1 font-mono">journals.view</code>
        — она видит «задачи» вместо «журналы», работает на Контрольной
        доске и проверяет выполненные задачи. Если нужно — поставь
        галочку ниже и она получит доступ к /journals.
      </div>

      <RolePresetsClient
        presets={presets}
        capabilityKeys={capabilityKeys}
        capabilityLabels={CAPABILITY_LABELS}
        initialOverrides={initialOverrides}
      />

      <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[12px] text-[#6f7282]">
        Чтобы сменить пресет конкретному сотруднику — открой{" "}
        <Link href="/settings/users" className="text-[#3848c7] underline">
          /settings/users
        </Link>{" "}
        и выбери из списка. Изменения применяются live — сотрудник сразу
        видит новый интерфейс при следующем reload.
      </div>
    </div>
  );
}
