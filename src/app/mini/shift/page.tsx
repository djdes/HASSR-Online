import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { buildMiniAppAuthBootstrapPath } from "@/lib/journal-obligation-links";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";
import { getUserRoleLabel } from "@/lib/user-roles";

/**
 * Shift screen for the Mini App.
 *
 * v1 is intentionally minimal: a list of active coworkers in the caller's
 * organisation, grouped by job position where available, so the cook/waiter
 * can see "who's with me today". Real time-based shift windows come later —
 * the schema doesn't carry shift rosters yet (see design doc §5.5).
 */
export default async function MiniShiftPage() {
  const session = await getServerSession(authOptions);
  // Без входа — на мини-вход с возвратом сюда же; без прав — на главную.
  if (!session) redirect(buildMiniAppAuthBootstrapPath("/mini/shift"));
  if (!hasFullWorkspaceAccess(session.user)) redirect("/mini");

  const orgId = getActiveOrgId(session);
  const coworkers = await db.user.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      archivedAt: null,
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      role: true,
      positionTitle: true,
      jobPosition: { select: { name: true } },
    },
  });

  const my = coworkers.find((c) => c.id === session.user.id);

  return (
    <div className="flex flex-1 flex-col gap-4 pb-24">
      <Link
        href="/mini"
        className="mini-press inline-flex w-fit items-center gap-1 text-[13px] font-medium"
        style={{ color: "var(--mini-text-muted)" }}
      >
        <ArrowLeft className="size-4" />
        На главную
      </Link>
      {/* Экран рисовался только для светлой темы: тёмный заголовок на
          тёмном фоне приложения просто не читался. */}
      <header className="px-1">
        <h1
          className="text-[20px] font-semibold"
          style={{ color: "var(--mini-text)" }}
        >
          Смена
        </h1>
        {my ? (
          <p
            className="mt-0.5 text-[13px]"
            style={{ color: "var(--mini-text-muted)" }}
          >
            Вы:{" "}
            <span className="font-medium" style={{ color: "var(--mini-text)" }}>
              {my.jobPosition?.name || my.positionTitle || getUserRoleLabel(my.role)}
            </span>
          </p>
        ) : null}
      </header>

      <section className="space-y-2">
        <h2
          className="px-1 text-[12px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--mini-text-muted)" }}
        >
          Сегодня работают · {coworkers.length}
        </h2>
        {coworkers.length === 0 ? (
          <div
            className="rounded-2xl border px-4 py-6 text-center text-[14px]"
            style={{
              background: "var(--mini-surface-1)",
              borderColor: "var(--mini-divider)",
              color: "var(--mini-text-muted)",
            }}
          >
            В организации пока нет активных сотрудников.
          </div>
        ) : (
          <ul className="space-y-2">
            {coworkers.map((c) => {
              const title =
                c.jobPosition?.name ||
                c.positionTitle ||
                getUserRoleLabel(c.role);
              const isMe = c.id === session.user.id;
              return (
                <li
                  key={c.id}
                  className="flex items-center gap-3 rounded-2xl border px-4 py-3"
                  style={{
                    background: "var(--mini-surface-1)",
                    borderColor: "var(--mini-divider)",
                  }}
                >
                  <div
                    className="flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
                    style={{
                      background: "var(--mini-surface-2)",
                      color: "var(--mini-text-muted)",
                    }}
                  >
                    {(c.name || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-[14px] font-medium"
                      style={{ color: "var(--mini-text)" }}
                    >
                      {c.name}
                      {isMe ? (
                        <span
                          className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{
                            background: "var(--mini-lime-soft)",
                            color: "var(--mini-lime)",
                          }}
                        >
                          вы
                        </span>
                      ) : null}
                    </div>
                    <div
                      className="truncate text-[12px]"
                      style={{ color: "var(--mini-text-muted)" }}
                    >
                      {title}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
