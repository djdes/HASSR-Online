"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRightLeft, Building2, Info, Library, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { MASTER_CABINET_HREF } from "@/lib/cabinet-menu";
import {
  initialMasterCabinetSelection,
  MASTER_CABINET_OBJECTS_MAX,
  summarizeMasterCabinetChoice,
  type MasterCabinetObject,
} from "@/lib/master-cabinet-choice";
import { switchOrganizationAndOpen } from "@/lib/switch-organization";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";
import { cn } from "@/lib/utils";
import {
  masterCabinetCreateErrorKey,
  masterCabinetListErrorKey,
  type MasterCabinetListErrorKey,
} from "./master-cabinet-ui-presentation";

const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60";
const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const OUTLINE =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-50";

function MasterCabinetOpenFailure() {
  const common = useTranslations("common");
  return common("error");
}

/**
 * Окно «Новый мастер-кабинет» — из меню профиля (раздел «Кабинет»: список
 * на компьютере, лист на телефоне, мини-приложение). Кабинетов сколько
 * угодно: название («Школы», «Сады») и объекты, которым кабинет раздаёт
 * меню и сырьё. Объект, который получал их из другого кабинета, подписан —
 * видно, что он перейдёт. Создаёт только владелец аккаунта
 * (`/api/settings/master-cabinets`).
 *
 * Портал в `document.body`, как у `ConfirmDialog`: в мини-приложении окно
 * рисуется из карточки профиля, и без портала его накрывали шапка и нижнее
 * меню (кнопка «Отмена» уходила под меню).
 */
export function CreateMasterCabinetDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** После создания (мини-приложение перечитывает список кабинетов). */
  onCreated?: (cabinet: { id: string; name: string }) => void;
}) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("masterCabinetUi");
  const currentT = useRef(t);
  useEffect(() => {
    currentT.current = t;
  }, [locale, t]);
  const [objects, setObjects] = useState<MasterCabinetObject[] | null>(null);
  const [loadError, setLoadError] = useState<MasterCabinetListErrorKey | null>(null);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let failureStatus: number | null = null;
    fetch("/api/settings/master-cabinets", { cache: "no-store" })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as {
          objects?: MasterCabinetObject[];
        } | null;
        if (!response.ok) {
          failureStatus = response.status;
          throw new Error("master_cabinet_list_failed");
        }
        if (!json?.objects) throw new Error("invalid_response");
        return json.objects;
      })
      .then((list) => {
        if (cancelled) return;
        setObjects(list);
        setSelected(initialMasterCabinetSelection(list));
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(failureStatus === null ? "errors.loadFailed" : masterCabinetListErrorKey(failureStatus));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const summary = useMemo(() => summarizeMasterCabinetChoice(objects ?? [], selected), [objects, selected]);
  const nameValid = name.replace(/\s+/g, " ").trim().length >= 2;
  const tooMany = summary.selected > MASTER_CABINET_OBJECTS_MAX;
  const canSubmit = nameValid && !saving && objects !== null && !tooMany;

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      const response = await fetch("/api/settings/master-cabinets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), organizationIds: selected }),
      });
      const json = (await response.json().catch(() => null)) as {
        cabinet?: { id: string; name: string };
      } | null;
      if (!response.ok) {
        toast.error(currentT.current(masterCabinetCreateErrorKey(response.status)));
        setSaving(false);
        return;
      }
      if (!json?.cabinet) {
        toast.error(currentT.current("errors.createFailed"));
        setSaving(false);
        return;
      }
      const cabinet = json.cabinet;
      toast.success(currentT.current("success.title", { cabinetName: cabinet.name }), {
        description: currentT.current("success.description"),
        action: {
          label: currentT.current("success.open"),
          onClick: () => {
            switchOrganizationAndOpen(cabinet.id, MASTER_CABINET_HREF).catch(() => {
              toast.error(<MasterCabinetOpenFailure />);
            });
          },
        },
      });
      onCreated?.(cabinet);
      onClose();
      router.refresh();
    } catch {
      toast.error(currentT.current("errors.createFailed"));
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[#0b1024]/40 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <BodyScrollLock />
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-master-cabinet-title"
        data-testid="create-master-cabinet-dialog"
        className="flex max-h-[90vh] w-full max-w-[480px] flex-col overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_30px_80px_-30px_rgba(11,16,36,0.5)]"
      >
        <div className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <Library className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="create-master-cabinet-title" className="text-[18px] font-semibold leading-snug text-[#0b1024]">
              {t("dialog.title")}
            </h2>
            <p className="mt-1 text-[13px] leading-[1.5] text-[#6f7282]">
              {t("dialog.intro")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label={t("dialog.close")}
            className="-mr-1 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl text-[#6f7282] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#0b1024] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("dialog.nameLabel")}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              maxLength={120}
              placeholder={t("dialog.namePlaceholder")}
              disabled={saving}
              className={INPUT}
              data-testid="create-master-cabinet-name"
            />
          </label>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-[#3c4053]">{t("dialog.objectsHeading")}</span>
              {objects && objects.length > 0 ? (
                <span className="shrink-0 rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[12px] font-medium tabular-nums text-[#3848c7]">
                  {t("dialog.selectedCount", { selected: summary.selected, total: objects.length })}
                </span>
              ) : null}
            </div>
            {loadError ? (
              <p className="mt-2 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]" role="alert">
                {t(loadError)}
              </p>
            ) : objects === null ? (
              <div className="mt-2 flex items-center gap-2 rounded-2xl border border-[#ececf4] px-4 py-3 text-[13px] text-[#6f7282]">
                <Loader2 className="size-4 animate-spin text-[#5566f6]" />
                {t("dialog.loading")}
              </div>
            ) : objects.length === 0 ? (
              <p className="mt-2 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[13px] leading-[1.5] text-[#6f7282]">
                {t("dialog.emptyObjects")}
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]">
                {objects.map((object) => {
                  const checked = selected.includes(object.id);
                  return (
                    <li key={object.id}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-[#f5f6ff]",
                          checked && "bg-[#fafbff]"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(object.id)}
                          disabled={saving}
                          className="mt-0.5 size-4 shrink-0 accent-[#5566f6]"
                          data-testid="create-master-cabinet-object"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-[14px] font-medium text-[#0b1024]">
                            <Building2 className="size-4 shrink-0 text-[#9b9fb3]" />
                            <span className="min-w-0 truncate">{object.name}</span>
                          </span>
                          <span
                            className={cn(
                              "mt-0.5 block text-[12px] leading-[1.45]",
                              object.currentCabinet ? "text-[#9a4a06]" : "text-[#6f7282]"
                            )}
                          >
                            {object.currentCabinet
                              ? t("dialog.currentCabinet", { cabinetName: object.currentCabinet.name })
                              : t("dialog.noCabinet")}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <ul className="mt-4 space-y-2 rounded-2xl bg-[#f5f6ff] p-3.5 text-[13px] leading-[1.5] text-[#3c4053]">
            <li className="flex gap-2">
              <Info className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
              <span>
                {summary.selected > 0
                  ? t("dialog.withSelection", { count: summary.selected })
                  : t("dialog.withoutSelection")}{" "}
                {t("dialog.directoryNote")}
              </span>
            </li>
            {summary.moving.map((move) => (
              <li key={move.cabinetName} className="flex gap-2 text-[#9a4a06]">
                <ArrowRightLeft className="mt-0.5 size-4 shrink-0" />
                <span>
                  {t("dialog.moving", { count: move.count, cabinetName: move.cabinetName })}
                </span>
              </li>
            ))}
            <li className="flex gap-2">
              <Library className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
              <span>
                {t("dialog.emptyCabinet")}
              </span>
            </li>
            {tooMany ? (
              <li className="font-medium text-[#a13a32]">
                {t("dialog.tooMany", { max: MASTER_CABINET_OBJECTS_MAX })}
              </li>
            ) : null}
          </ul>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-[#ececf4] px-5 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={saving} className={OUTLINE}>
            {t("dialog.cancel")}
          </button>
          <button type="submit" disabled={!canSubmit} className={PRIMARY} data-testid="create-master-cabinet-submit">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Library className="size-4" />}
            {saving ? t("dialog.creating") : t("dialog.create")}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
