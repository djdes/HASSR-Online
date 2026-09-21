"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

type CatalogItem = { code: string; name: string };
type AccessRow = {
  templateCode: string;
  canRead: boolean;
  canWrite: boolean;
  canFinalize: boolean;
};

type Props = {
  userId: string;
  catalog: CatalogItem[];
  initialAccess: AccessRow[];
};

export function UserAccessEditor({ userId, catalog, initialAccess }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<Map<string, AccessRow>>(() => {
    const map = new Map<string, AccessRow>();
    for (const item of catalog) {
      map.set(item.code, {
        templateCode: item.code,
        canRead: false,
        canWrite: false,
        canFinalize: false,
      });
    }
    for (const row of initialAccess) {
      map.set(row.templateCode, row);
    }
    return map;
  });

  function toggle(code: string, key: keyof Omit<AccessRow, "templateCode">) {
    setState((prev) => {
      const next = new Map(prev);
      const current = next.get(code) ?? {
        templateCode: code,
        canRead: false,
        canWrite: false,
        canFinalize: false,
      };
      const nextVal = !current[key];
      const updated = { ...current, [key]: nextVal };
      // Auto: canWrite / canFinalize require canRead
      if (key === "canRead" && !nextVal) {
        updated.canWrite = false;
        updated.canFinalize = false;
      }
      if ((key === "canWrite" || key === "canFinalize") && nextVal) {
        updated.canRead = true;
      }
      next.set(code, updated);
      return next;
    });
  }

  function toggleAll(select: boolean) {
    setState((prev) => {
      const next = new Map(prev);
      for (const item of catalog) {
        next.set(item.code, {
          templateCode: item.code,
          canRead: select,
          canWrite: select,
          canFinalize: false,
        });
      }
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const access = [...state.values()].filter(
        (row) => row.canRead || row.canWrite || row.canFinalize
      );
      const res = await fetch(`/api/users/${userId}/access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Не удалось сохранить");
      }
      toast.success("Доступ обновлён");
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Ошибка при сохранении"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-2xl border-[#eef0fb] px-4 text-[15px] text-[#5464ff]"
          onClick={() => toggleAll(true)}
        >
          Разрешить все
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-2xl border-[#eef0fb] px-4 text-[15px] text-[#5464ff]"
          onClick={() => toggleAll(false)}
        >
          Запретить все
        </Button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <table className="w-full min-w-[620px] text-[15px]">
          <thead className="bg-[#f6f7fb] text-[14px] text-[#6f7282]">
            <tr>
              {/* Первая колонка закреплена: на телефоне таблицу крутят
                  вбок, и название журнала уезжало — оставались
                  безымянные галочки. Фон непрозрачный, иначе под ним
                  просвечивают проезжающие ячейки. */}
              <th className="sticky left-0 z-10 bg-[#f6f7fb] px-6 py-3 text-left font-medium">
                Журнал
              </th>
              <th className="w-[120px] py-3 text-center font-medium">
                Просмотр
              </th>
              <th className="w-[120px] py-3 text-center font-medium">
                Заполнение
              </th>
              <th className="w-[120px] py-3 text-center font-medium">
                Закрытие
              </th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((item) => {
              const row = state.get(item.code);
              return (
                <tr
                  key={item.code}
                  className="border-t border-[#eef0f6] last:border-b-0"
                >
                  <td className="sticky left-0 z-10 bg-white px-6 py-3 text-[15px] text-black">
                    {item.name}
                  </td>
                  <td className="py-3 text-center">
                    <Checkbox
                      checked={row?.canRead === true}
                      onCheckedChange={() => toggle(item.code, "canRead")}
                    />
                  </td>
                  <td className="py-3 text-center">
                    <Checkbox
                      checked={row?.canWrite === true}
                      onCheckedChange={() => toggle(item.code, "canWrite")}
                    />
                  </td>
                  <td className="py-3 text-center">
                    <Checkbox
                      checked={row?.canFinalize === true}
                      onCheckedChange={() => toggle(item.code, "canFinalize")}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          className="h-11 rounded-2xl bg-[#5566f6] px-4 text-[15px] text-white hover:bg-[#4959eb]"
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? "Сохранение..." : "Сохранить"}
        </Button>
      </div>
    </div>
  );
}
