"use client";

import { useState } from "react";
import { useSubmitLock } from "@/lib/use-submit-lock";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FloatingLabelField } from "@/components/journals/journal-dialog-field";
import {
  JOURNAL_DIALOG_FIELD_CONTROL_CLASS,
  JOURNAL_DIALOG_FIELD_TEXTAREA_CLASS,
  JOURNAL_DIALOG_FIELD_TRIGGER_CLASS,
} from "@/components/journals/journal-responsive";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface AreaDialogProps {
  area?: { id: string; name: string; description: string | null; buildingId?: string | null };
  /** Точки организации. Выбор показываем, когда их две и больше. */
  buildings?: Array<{ id: string; name: string }>;
  /** Точка нового цеха по умолчанию — выбранная в шапке или единственная. */
  defaultBuildingId?: string | null;
  /** Можно ли «Без точки» (общий цех ведёт офис — руководителю точки нельзя). */
  allowNoPoint?: boolean;
}

/** Значение «без точки» в выпадающем списке (Select не принимает пустую строку). */
const NO_BUILDING = "__none__";

export function AreaDialog({ area, buildings = [], defaultBuildingId = null, allowNoPoint = true }: AreaDialogProps) {
  const t = useTranslations("settingsUi.areaDialog");
  const tc = useTranslations("common");
  const router = useRouter();
  const isEdit = !!area;
  const [open, setOpen] = useState(false);
  // Двойной тап по кнопке успевал отправить два одинаковых запроса:
  // setState применяется только к следующему рендеру. Замок синхронный.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(area?.name ?? "");
  const [description, setDescription] = useState(area?.description ?? "");
  const initialBuilding =
    (area ? area.buildingId : defaultBuildingId) ?? (allowNoPoint ? NO_BUILDING : (buildings[0]?.id ?? NO_BUILDING));
  const [buildingId, setBuildingId] = useState(initialBuilding);
  // Выбор точки — когда их несколько, или у цеха точки ещё нет (иначе его
  // не перенести в единственную точку).
  const showBuilding = buildings.length >= 2 || (buildings.length === 1 && Boolean(area) && !area?.buildingId);

  function resetForm() {
    setName(area?.name ?? "");
    setDescription(area?.description ?? "");
    setBuildingId(initialBuilding);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!acquire()) return;
    setError(null);

    try {
      const url = isEdit ? `/api/areas/${area.id}` : "/api/areas";
      const response = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || undefined,
          // Точка: при одной точке сервер ставит её сам; выбор — когда их несколько.
          ...(showBuilding ? { buildingId: buildingId === NO_BUILDING ? null : buildingId } : {}),
        }),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || t("error"));
      }

      if (!isEdit) resetForm();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      release();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="sm"><Pencil className="size-4" /></Button>
        ) : (
          <Button><Plus className="size-4" />{t("addArea")}</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editArea") : t("addArea")}</DialogTitle>
        </DialogHeader>
        {/* Поля — с подписью внутри рамки (`FloatingLabelField`): окно ниже. */}
        <form onSubmit={handleSubmit} className="space-y-2.5">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}
          <FloatingLabelField label={t("nameLabel")} htmlFor="area-name" required>
            <Input
              id="area-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              required
              className={JOURNAL_DIALOG_FIELD_CONTROL_CLASS}
            />
          </FloatingLabelField>
          {showBuilding ? (
            <div>
              <FloatingLabelField label={t("pointLabel")} htmlFor="area-building">
                <Select value={buildingId} onValueChange={setBuildingId}>
                  <SelectTrigger id="area-building" className={JOURNAL_DIALOG_FIELD_TRIGGER_CLASS}>
                    <SelectValue placeholder={t("pointPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {buildings.map((building) => (
                      <SelectItem key={building.id} value={building.id}>
                        {building.name}
                      </SelectItem>
                    ))}
                    {allowNoPoint ? <SelectItem value={NO_BUILDING}>{t("noPoint")}</SelectItem> : null}
                  </SelectContent>
                </Select>
              </FloatingLabelField>
              <p className="mt-1.5 text-[12.5px] text-[#6f7282]">
                {isEdit
                  ? t("editHint")
                  : t("createHint")}
              </p>
            </div>
          ) : null}
          <FloatingLabelField label={t("descriptionLabel")} htmlFor="area-description">
            <Textarea
              id="area-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("descriptionPlaceholder")}
              className={cn(JOURNAL_DIALOG_FIELD_TEXTAREA_CLASS, "min-h-[52px]")}
            />
          </FloatingLabelField>
          <div className="flex justify-end gap-2 pt-1.5">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>{tc("cancel")}</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? tc("saving") : isEdit ? tc("save") : t("create")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
