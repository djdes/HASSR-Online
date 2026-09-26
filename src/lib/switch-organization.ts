/**
 * Сменить активную организацию и открыть страницу уже в ней.
 *
 * Полная загрузка (`location.assign`), а не переход роутера: смена
 * организации перевыпускает куку сессии, и proxy должен увидеть новую.
 * Сессию мастер-кабинета (`kind="directory"`) proxy пускает только в
 * `/master`, сессию обычной организации — везде, кроме `/master`.
 *
 * Бросает с текстом для человека, если переключиться не удалось.
 */
export async function switchOrganizationAndOpen(organizationId: string, target: string): Promise<void> {
  const response = await fetch("/api/me/active-organization", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
  const json = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(json?.error ?? "Не удалось переключиться");
  window.location.assign(target);
}
