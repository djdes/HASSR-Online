"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

/**
 * Быстрое создание сотрудника прямо в журнале.
 *
 * Зачем: чтобы поставить строку в журнал, человека сначала надо завести
 * в «Настройки → Сотрудники». Окно «Добавление новой строки» в тупике
 * так и писало — «сначала заведите сотрудника», — и заполнение журнала
 * прерывалось походом в другой раздел с потерей контекста. Здесь тот же
 * минимум полей, что и в карточке найма: ФИО и должность. Остальное
 * (телефон, точки, график выходных) остаётся в полной карточке, ссылка
 * на неё рядом.
 *
 * После создания сотрудник сразу возвращается вызывающему коду — тот
 * ставит его строку в документ без второго действия.
 */

type Position = { id: string; name: string; categoryKey: string };

const NEW_POSITION = "__new__";

export function QuickAddEmployee({
  onCreated,
  submitLabel = "Создать и добавить",
  className,
}: {
  /** Сотрудник создан. Вызывающий ставит его строку в документ. */
  onCreated: (user: { id: string; name: string }) => void | Promise<void>;
  submitLabel?: string;
  className?: string;
}) {
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [positionId, setPositionId] = useState("");
  const [newPositionName, setNewPositionName] = useState("");
  const [fullName, setFullName] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/positions")
      .then((r) => r.json())
      .then((data: { positions?: Position[] }) => {
        if (!alive) return;
        const list = data.positions ?? [];
        setPositions(list);
        // Единственная должность выбирается сама — лишний клик ни о чём.
        if (list.length === 1) setPositionId(list[0].id);
      })
      .catch(() => {
        if (alive) setPositions([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const creatingPosition = positionId === NEW_POSITION;
  const canSubmit =
    fullName.trim().length >= 2 &&
    (creatingPosition ? newPositionName.trim().length >= 2 : Boolean(positionId));

  async function submit() {
    if (!canSubmit || pending) return;
    setPending(true);
    try {
      let jobPositionId = positionId;

      if (creatingPosition) {
        const res = await fetch("/api/positions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newPositionName.trim(),
            // Должность из журнала — это линейный персонал; руководящие
            // заводят в разделе сотрудников, там виден и состав категории.
            categoryKey: "staff",
          }),
        });
        const data = (await res.json().catch(() => null)) as
          | { position?: Position; error?: string }
          | null;
        if (!res.ok || !data?.position) {
          throw new Error(data?.error ?? "Не удалось создать должность");
        }
        jobPositionId = data.position.id;
      }

      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobPositionId, fullName: fullName.trim() }),
      });
      const data = (await res.json().catch(() => null)) as
        | { user?: { id: string; name: string }; error?: string }
        | null;
      if (!res.ok || !data?.user) {
        throw new Error(data?.error ?? "Не удалось создать сотрудника");
      }

      setFullName("");
      setNewPositionName("");
      await onCreated(data.user);
    } catch (error) {
      toast.error(humanizeFetchError(error, "Ошибка"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={className}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
            Ф.И.О. сотрудника
          </span>
          <Input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            placeholder="Иванова Ольга Петровна"
            className="h-11 rounded-2xl border-[#dcdfed] text-[15px]"
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
            Должность
          </span>
          <Select value={positionId} onValueChange={setPositionId}>
            <SelectTrigger className="h-11 w-full rounded-2xl border-[#dcdfed] text-[15px]">
              <SelectValue
                placeholder={positions === null ? "Загружаем…" : "Выберите"}
              />
            </SelectTrigger>
            <SelectContent>
              {(positions ?? []).map((position) => (
                <SelectItem key={position.id} value={position.id}>
                  {position.name}
                </SelectItem>
              ))}
              <SelectItem value={NEW_POSITION}>
                <span className="inline-flex items-center gap-1.5">
                  <Plus className="size-3.5" />
                  Новая должность
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      {creatingPosition ? (
        <label className="mt-3 block space-y-1.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
            Название должности
          </span>
          <Input
            value={newPositionName}
            onChange={(event) => setNewPositionName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            placeholder="Повар"
            className="h-11 rounded-2xl border-[#dcdfed] text-[15px]"
          />
        </label>
      ) : null}

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/settings/users"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-[#3848c7] hover:underline"
        >
          Все сотрудники и их карточки
          <ArrowUpRight className="size-3.5" />
        </Link>
        <Button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          loading={pending}
          className="h-11 w-full rounded-2xl bg-[#5566f6] px-5 text-[15px] font-semibold text-white hover:bg-[#4a5bf0] sm:w-auto"
        >
          {submitLabel}
        </Button>
      </div>

      <p className="mt-2 text-[12.5px] leading-[1.45] text-[#9b9fb3]">
        Телефон, точки и график выходных можно заполнить позже в карточке
        сотрудника.
      </p>
    </div>
  );
}
