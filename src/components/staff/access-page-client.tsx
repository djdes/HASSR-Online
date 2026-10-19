"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Eye, KeyRound, Network, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";

/** Сколько должностей показываем у набора до «и ещё N». */
const POSITIONS_PREVIEW = 6;
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageGuide } from "@/components/ui/page-guide";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { NavIcon } from "@/components/layout/nav-icons";
import { StaffPicker } from "@/components/shared/staff-picker";
import {
  AUTO_PRESET,
  StaffPresetPicker,
  type PresetChoice,
} from "@/components/staff/staff-preset-picker";
import {
  PersonAvatar,
  STAFF_BUTTON_OUTLINE,
  STAFF_BUTTON_PRIMARY,
  STAFF_PILL,
  StaffCard,
  StaffEmptyState,
} from "@/components/staff/staff-page-ui";
import type { MessageContract } from "@/i18n/message-contract";
import type { NavSectionKey } from "@/lib/app-nav";
import type { Capability, PermissionPreset } from "@/lib/permission-presets";
import type { PositionCategoryKey } from "@/lib/staffing";
import type { PositionGroup, PresetHolders, SectionVisibility } from "@/lib/staff-access-overview";
import { cn } from "@/lib/utils";

type PresetKey = keyof MessageContract["staffManagement"]["access"]["presets"];
type CapabilityKey = keyof MessageContract["staffManagement"]["access"]["capabilities"];

export type AccessPreset = {
  value: PermissionPreset;
  capabilities: Capability[];
  holders: PresetHolders;
  group: PositionGroup;
  sections: Record<NavSectionKey, SectionVisibility>;
};

export type AccessPersonRow = {
  id: string;
  name: string;
  position: string | null;
  isManager: boolean;
  effective: PermissionPreset;
  byPosition: PermissionPreset;
  manual: boolean;
  isSelf: boolean;
  sections: NavSectionKey[];
};

type Props = {
  canChangePresets: boolean;
  showPermissions: boolean;
  sections: Array<{ key: NavSectionKey; icon: string }>;
  presets: AccessPreset[];
  people: AccessPersonRow[];
  journals: {
    total: number;
    personal: number;
    positions: Array<{ id: string; name: string; categoryKey: PositionCategoryKey; people: number; journals: number }>;
  };
  visibility: { total: number; configured: Array<{ id: string; name: string; sees: number }> };
};

/** Больше стольких людей — над списком появляется поиск. */
const SEARCH_FROM = 8;

export function AccessPageClient(props: Props) {
  const t = useTranslations("staffPages.access");
  const tAccess = useTranslations("staffManagement.access");
  const presetLabel = (preset: PermissionPreset) => tAccess(`presets.${preset as PresetKey}.label`);
  const [editing, setEditing] = useState<AccessPersonRow | null>(null);
  let step = 0;
  const next = () => ++step;

  return (
    <div className="space-y-4" data-access-page>
      <SectionPageHeader description={t("description")} />

      <PageGuide
        storageKey="settings-access"
        title={t("guide.title")}
        bullets={[
          { title: t("guide.presetTitle"), body: t("guide.presetBody") },
          { title: t("guide.autoTitle"), body: t("guide.autoBody") },
          { title: t("guide.sectionsTitle"), body: t("guide.sectionsBody") },
          { title: t("guide.journalsTitle"), body: t("guide.journalsBody") },
        ]}
      />

      <PresetsCard number={next()} presets={props.presets} canConfigure={props.canChangePresets} presetLabel={presetLabel} />

      <PeopleCard
        number={next()}
        people={props.people}
        canChange={props.canChangePresets}
        presetLabel={presetLabel}
        onEdit={setEditing}
      />

      <SectionsCard number={next()} sections={props.sections} presets={props.presets} people={props.people} presetLabel={presetLabel} />

      <StaffCard
        id="journals"
        number={next()}
        title={t("journals.title")}
        description={t("journals.description", { total: String(props.journals.total) })}
      >
        {props.journals.positions.length === 0 ? (
          <StaffEmptyState title={t("journals.emptyTitle")} hint={t("journals.emptyHint")}>
            <Link href="/settings/positions" className={STAFF_BUTTON_OUTLINE}>
              {t("journals.toPositions")}
            </Link>
          </StaffEmptyState>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2" data-access-journals>
            {props.journals.positions.map((position) => (
              <li
                key={position.id}
                className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3.5 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-[#0b1024]">{position.name}</span>
                  <span className="block text-[12px] text-[#6f7282]">{t("journals.people", { count: position.people })}</span>
                </span>
                <span
                  className={cn(
                    STAFF_PILL,
                    "shrink-0",
                    position.journals > 0 ? "bg-[#eef1ff] text-[#3848c7]" : "bg-[#f3f4f8] text-[#9b9fb3]"
                  )}
                >
                  {position.journals > 0
                    ? t("journals.count", { count: String(position.journals), total: String(props.journals.total) })
                    : t("journals.none")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[13px] leading-[1.5] text-[#6f7282]">
          {props.journals.personal > 0 ? t("journals.personal", { count: props.journals.personal }) : t("journals.personalNone")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/settings/journal-access" className={STAFF_BUTTON_OUTLINE} data-testid="access-link-journal-access">
            <KeyRound className="size-4 text-[#5566f6]" />
            {t("journals.byPerson")}
          </Link>
          <Link href="/settings/journals-by-position" className={STAFF_BUTTON_OUTLINE} data-testid="access-link-journals-by-position">
            <Network className="size-4 text-[#5566f6]" />
            {t("journals.byPosition")}
          </Link>
        </div>
      </StaffCard>

      <StaffCard id="visibility" number={next()} title={t("visibility.title")} description={t("visibility.description")}>
        <p className="text-[14px] text-[#0b1024]">
          {t("visibility.summary", { configured: String(props.visibility.configured.length), total: String(props.visibility.total) })}
        </p>
        {props.visibility.configured.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {props.visibility.configured.map((position) => (
              <li key={position.id} className={cn(STAFF_PILL, "bg-[#eef1ff] py-1 text-[#3848c7]")}>
                {t("visibility.position", { name: position.name, count: position.sees })}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2 text-[13px] leading-[1.5] text-[#6f7282]">{t("visibility.rest")}</p>
        <Link href="/settings/position-staff-visibility" className={cn(STAFF_BUTTON_OUTLINE, "mt-3")}>
          <Eye className="size-4 text-[#5566f6]" />
          {t("visibility.open")}
        </Link>
      </StaffCard>

      {props.showPermissions ? (
        <StaffCard id="permissions" number={next()} title={t("permissions.title")} description={t("permissions.description")}>
          <Link href="/settings/permissions" className={STAFF_BUTTON_OUTLINE} data-testid="access-link-permissions">
            <ShieldCheck className="size-4 text-[#5566f6]" />
            {t("permissions.open")}
          </Link>
        </StaffCard>
      ) : null}

      {editing ? (
        <PresetDialog
          person={editing}
          presets={props.presets}
          presetLabel={presetLabel}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function CapabilityChips({ capabilities }: { capabilities: Capability[] }) {
  const tAccess = useTranslations("staffManagement.access");
  return (
    <ul className="flex flex-wrap gap-1.5">
      {capabilities.map((capability) => (
        <li
          key={capability}
          className="inline-flex items-center gap-1 rounded-full border border-[#dfe3ff] bg-white px-2.5 py-0.5 text-[11.5px] leading-5 text-[#3848c7]"
        >
          <Check className="size-3" aria-hidden />
          {tAccess(`capabilities.${capability.replace(".", "_") as CapabilityKey}`)}
        </li>
      ))}
    </ul>
  );
}

function PresetsCard({
  number,
  presets,
  canConfigure,
  presetLabel,
}: {
  number: number;
  presets: AccessPreset[];
  canConfigure: boolean;
  presetLabel: (preset: PermissionPreset) => string;
}) {
  const t = useTranslations("staffPages.access");
  const tAccess = useTranslations("staffManagement.access");
  return (
    <StaffCard
      id="presets"
      number={number}
      title={t("presets.title")}
      description={t("presets.description")}
      aside={
        canConfigure ? (
          <Link href="/settings/role-presets" className={STAFF_BUTTON_OUTLINE} data-testid="access-link-role-presets">
            <SlidersHorizontal className="size-4 text-[#5566f6]" />
            {t("presets.configure")}
          </Link>
        ) : null
      }
    >
      <ul className="grid gap-3 lg:grid-cols-2" data-access-presets>
        {presets.map((preset) => (
          <li
            key={preset.value}
            data-preset={preset.value}
            className="flex min-w-0 flex-col gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
              <span className="text-[15px] font-semibold text-[#0b1024]">{presetLabel(preset.value)}</span>
              <span className={cn(STAFF_PILL, "ml-auto bg-white text-[#6f7282] ring-1 ring-[#ececf4]")}>
                {t("presets.people", { count: preset.holders.total })}
              </span>
            </div>
            <p className="text-[13px] leading-[1.5] text-[#3c4053]">
              {tAccess(`presets.${preset.value as PresetKey}.description`)}
            </p>
            <CapabilityChips capabilities={preset.capabilities} />
            <p className="text-[12.5px] leading-[1.5] text-[#6f7282]">
              {preset.holders.positions.length > 0
                ? t("presets.byPosition", {
                    positions:
                      preset.holders.positions.slice(0, POSITIONS_PREVIEW).join(", ") +
                      (preset.holders.positions.length > POSITIONS_PREVIEW
                        ? ` ${t("presets.more", { count: String(preset.holders.positions.length - POSITIONS_PREVIEW) })}`
                        : ""),
                  })
                : t("presets.byPositionNone")}
              {preset.holders.manual > 0 ? ` ${t("presets.manual", { count: String(preset.holders.manual) })}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </StaffCard>
  );
}

function PeopleCard({
  number,
  people,
  canChange,
  presetLabel,
  onEdit,
}: {
  number: number;
  people: AccessPersonRow[];
  canChange: boolean;
  presetLabel: (preset: PermissionPreset) => string;
  onEdit: (person: AccessPersonRow) => void;
}) {
  const t = useTranslations("staffPages.access");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (person) => person.name.toLowerCase().includes(q) || (person.position ?? "").toLowerCase().includes(q)
    );
  }, [people, query]);

  return (
    <StaffCard
      id="people"
      number={number}
      title={t("people.title")}
      description={canChange ? t("people.description") : t("people.descriptionReadOnly")}
    >
      {people.length > SEARCH_FROM ? (
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("people.search")}
            aria-label={t("people.search")}
            className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white pl-10 pr-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
      ) : null}
      {people.length === 0 ? (
        <StaffEmptyState title={t("people.emptyTitle")} hint={t("people.emptyHint")}>
          <Link href="/settings/users" className={STAFF_BUTTON_OUTLINE}>
            {t("people.toStaff")}
          </Link>
        </StaffEmptyState>
      ) : filtered.length === 0 ? (
        <p className="px-1 py-6 text-center text-[13px] text-[#9b9fb3]">{t("people.notFound")}</p>
      ) : (
        <ul className="divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]" data-access-people>
          {filtered.map((person) => (
            <li
              key={person.id}
              data-person={person.name}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-white px-3 py-2.5 transition-colors duration-150 hover:bg-[#fafbff] sm:px-4"
            >
              <PersonAvatar name={person.name} />
              <span className="min-w-0 flex-1 basis-[160px]">
                <span className="block text-[14px] font-medium text-[#0b1024] [overflow-wrap:anywhere]">
                  {person.name}
                  {person.isSelf ? <span className="ml-1.5 text-[12px] font-normal text-[#9b9fb3]">{t("people.self")}</span> : null}
                </span>
                <span className="block text-[12.5px] text-[#6f7282]">{person.position ?? t("people.noPosition")}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className={cn(STAFF_PILL, "bg-[#eef1ff] text-[#3848c7]")} data-testid="person-preset">
                  {presetLabel(person.effective)}
                </span>
                <span
                  className={cn(
                    STAFF_PILL,
                    person.manual ? "bg-[#fff8eb] text-[#b25f00]" : "bg-[#f3f4f8] text-[#6f7282]"
                  )}
                >
                  {person.manual ? t("people.manual") : t("people.auto")}
                </span>
              </span>
              {canChange ? (
                <button
                  type="button"
                  onClick={() => onEdit(person)}
                  className="inline-flex h-9 shrink-0 items-center rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                  data-testid="person-preset-edit"
                  aria-label={t("people.changeFor", { name: person.name })}
                >
                  {t("people.change")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </StaffCard>
  );
}

const VISIBILITY_CLASS: Record<SectionVisibility, string> = {
  visible: "border-[#5566f6] bg-[#5566f6] text-white",
  hidden: "border-[#ececf4] bg-[#f6f7fb] text-[#c3c7d6]",
  depends: "border-dashed border-[#e0a33a] bg-[#fff8eb] text-[#b25f00]",
};

/** Ряд из девяти иконок разделов: видит / не видит / зависит от личного доступа. */
function SectionIcons({
  sections,
  state,
}: {
  sections: Array<{ key: NavSectionKey; icon: string }>;
  state: (key: NavSectionKey) => SectionVisibility;
}) {
  const t = useTranslations("staffPages.access");
  const tSections = useTranslations("navigation.shell.sections");
  return (
    <ul className="flex flex-wrap gap-1.5">
      {sections.map((section) => {
        const value = state(section.key);
        const label = `${tSections(section.key)} — ${t(`sections.state.${value}`)}`;
        return (
          <li
            key={section.key}
            title={label}
            aria-label={label}
            data-section={section.key}
            data-state={value}
            className={cn(
              "flex size-9 items-center justify-center rounded-xl border transition-colors duration-150",
              VISIBILITY_CLASS[value]
            )}
          >
            <NavIcon name={section.icon} className="size-4" />
          </li>
        );
      })}
    </ul>
  );
}

function SectionsCard({
  number,
  sections,
  presets,
  people,
  presetLabel,
}: {
  number: number;
  sections: Array<{ key: NavSectionKey; icon: string }>;
  presets: AccessPreset[];
  people: AccessPersonRow[];
  presetLabel: (preset: PermissionPreset) => string;
}) {
  const t = useTranslations("staffPages.access");
  const tSections = useTranslations("navigation.shell.sections");
  const [personId, setPersonId] = useState<string | null>(null);
  const person = people.find((item) => item.id === personId) ?? null;

  return (
    <StaffCard id="sections" number={number} title={t("sections.title")} description={t("sections.description")}>
      {/* Легенда: какой раздел какой иконкой — подписи разделов рядом с иконками. */}
      <ul className="mb-4 grid gap-x-4 gap-y-1.5 text-[12.5px] text-[#3c4053] sm:grid-cols-3">
        {sections.map((section) => (
          <li key={section.key} className="flex min-w-0 items-center gap-2">
            <NavIcon name={section.icon} className="size-4 shrink-0 text-[#5566f6]" />
            <span className="truncate">{tSections(section.key)}</span>
          </li>
        ))}
      </ul>

      <ul className="space-y-2" data-access-sections>
        {presets.map((preset) => (
          <li
            key={preset.value}
            data-preset-sections={preset.value}
            className="flex flex-col gap-2 rounded-2xl border border-[#ececf4] px-3.5 py-3 lg:flex-row lg:items-center lg:justify-between"
          >
            <span className="min-w-0">
              <span className="block text-[14px] font-medium text-[#0b1024]">{presetLabel(preset.value)}</span>
              <span className="block text-[12px] text-[#6f7282]">{t(`sections.group.${preset.group}`)}</span>
            </span>
            <SectionIcons sections={sections} state={(key) => preset.sections[key]} />
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-[#6f7282]">
        {(["visible", "hidden", "depends"] as const).map((value) => (
          <span key={value} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-3.5 rounded-md border", VISIBILITY_CLASS[value])} />
            {t(`sections.legend.${value}`)}
          </span>
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4" data-access-person-sections>
        <div className="mb-2 text-[13.5px] font-medium text-[#0b1024]">{t("sections.personTitle")}</div>
        <div className="max-w-[420px]">
          <StaffPicker
            value={personId}
            onChange={setPersonId}
            staff={people.map((item) => ({
              id: item.id,
              name: item.name,
              title: item.position ?? "",
              isManager: item.isManager,
            }))}
            placeholder={t("sections.personPlaceholder")}
          />
        </div>
        {person ? (
          <div className="mt-3 space-y-2">
            <p className="text-[13px] text-[#3c4053]">
              {t("sections.personPreset", { preset: presetLabel(person.effective) })}{" "}
              <span className="text-[#6f7282]">{person.manual ? t("people.manual") : t("people.auto")}</span>
            </p>
            <SectionIcons sections={sections} state={(key) => (person.sections.includes(key) ? "visible" : "hidden")} />
            <p className="text-[12.5px] text-[#6f7282]">
              {person.sections.length === 0
                ? t("sections.personNone")
                : t("sections.personSees", {
                    sections: sections
                      .filter((section) => person.sections.includes(section.key))
                      .map((section) => tSections(section.key))
                      .join(", "),
                  })}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-[12.5px] text-[#6f7282]">{t("sections.personHint")}</p>
        )}
      </div>
      <p className="mt-3 text-[12.5px] leading-[1.5] text-[#6f7282]">{t("sections.footnote")}</p>
    </StaffCard>
  );
}

/** Окно «Набор прав» сотрудника: тот же выбор, что в окне доступа на «Сотрудниках». */
function PresetDialog({
  person,
  presets,
  presetLabel,
  onClose,
}: {
  person: AccessPersonRow;
  presets: AccessPreset[];
  presetLabel: (preset: PermissionPreset) => string;
  onClose: () => void;
}) {
  const t = useTranslations("staffPages.access");
  const tAccess = useTranslations("staffManagement.access");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const saved: PresetChoice = person.manual ? person.effective : AUTO_PRESET;
  const [value, setValue] = useState<PresetChoice>(saved);
  const [pending, setPending] = useState(false);

  async function save() {
    if (value === saved) {
      onClose();
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/staff/${person.id}/preset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset: value === AUTO_PRESET ? null : value }),
      });
      const payload = (await response.json().catch(() => null)) as { code?: string } | null;
      if (!response.ok) {
        toast.error(
          payload?.code === "SELF_LOCKOUT"
            ? tAccess("presetSelfLocked")
            : response.status === 403
              ? t("people.forbidden")
              : tAccess("presetSaveFailed")
        );
        return;
      }
      toast.success(
        t("people.saved", {
          name: person.name,
          preset: value === AUTO_PRESET ? presetLabel(person.byPosition) : presetLabel(value),
        })
      );
      onClose();
      startTransition(() => router.refresh());
    } catch {
      toast.error(t("people.network"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 supports-[height:100dvh]:max-h-[88dvh] sm:max-w-[560px]">
        <DialogHeader className="shrink-0 border-b px-4 py-5 pr-14 sm:pl-6">
          <DialogTitle className="text-[18px] font-semibold text-[#0b1024]">{t("people.dialogTitle", { name: person.name })}</DialogTitle>
          <DialogDescription className="text-[13px] text-[#6f7282]">
            {person.position ?? t("people.noPosition")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
          <StaffPresetPicker
            presets={presets.map((preset) => ({ value: preset.value, capabilities: preset.capabilities }))}
            value={value}
            saved={saved}
            defaultPreset={person.byPosition}
            onChange={setValue}
            readOnly={false}
            isSelf={person.isSelf}
            defaultOpen
          />
        </div>
        <DialogFooter className="shrink-0 flex-wrap justify-end gap-2 border-t bg-white px-4 py-4 sm:flex-row sm:px-6">
          <button type="button" onClick={onClose} className={STAFF_BUTTON_OUTLINE}>
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={pending || value === saved}
            className={STAFF_BUTTON_PRIMARY}
            data-testid="person-preset-save"
          >
            {pending ? t("saving") : t("save")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
