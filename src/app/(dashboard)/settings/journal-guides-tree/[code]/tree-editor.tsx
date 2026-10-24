"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BookOpen,
  GripVertical,
  Image as ImageIcon,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import type { GuideNode, GuideTree } from "@/lib/journal-guide-tree";

type Props = {
  code: string;
  journalName: string;
  initialTree: GuideTree | null;
};

function flattenTree(nodes: GuideNode[]): GuideNode[] {
  const byParent = new Map<string | null, GuideNode[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.ordering - b.ordering);
  }
  const result: GuideNode[] = [];
  function walk(parentId: string | null) {
    for (const node of byParent.get(parentId) ?? []) {
      result.push(node);
      walk(node.id);
    }
  }
  walk(null);
  return result;
}

function depthOf(node: GuideNode, all: GuideNode[]): number {
  let depth = 0;
  let current: GuideNode | undefined = node;
  while (current?.parentId) {
    current = all.find((n) => n.id === current!.parentId);
    if (!current) break;
    depth++;
    if (depth > 5) break;
  }
  return depth;
}

export function GuideTreeEditorClient({
  code,
  journalName,
  initialTree,
}: Props) {
  const t = useTranslations("settingsUi.guideTreeEditor");
  const router = useRouter();
  const [tree, setTree] = useState<GuideTree | null>(initialTree);
  const [, startTransition] = useTransition();

  const [addOpen, setAddOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<GuideNode | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GuideNode | null>(null);

  const flatNodes = useMemo(
    () => (tree?.nodes ? flattenTree(tree.nodes) : []),
    [tree]
  );

  async function refresh() {
    const response = await fetch(`/api/settings/journal-guides/${code}`, {
      method: "GET",
      cache: "no-store",
    });
    const data = (await response.json().catch(() => null)) as
      | { tree: GuideTree | null }
      | null;
    if (data) setTree(data.tree);
    startTransition(() => router.refresh());
  }

  async function handleDelete(node: GuideNode) {
    const response = await fetch(
      `/api/settings/journal-guides/${code}/nodes/${node.id}`,
      { method: "DELETE" }
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      toast.error(data?.error || t("deleteNodeFailed"));
      return;
    }
    setTree(data.tree);
    toast.success(t("stepDeleted"));
    setConfirmDelete(null);
    startTransition(() => router.refresh());
  }

  function computeOrdering(
    siblings: GuideNode[],
    targetIndex: number
  ): number {
    const before = siblings[targetIndex - 1]?.ordering;
    const after = siblings[targetIndex]?.ordering;
    if (before === undefined && after === undefined) return 1024;
    if (before === undefined && after !== undefined) return after / 2;
    if (after === undefined && before !== undefined) return before + 1024;
    return ((before ?? 0) + (after ?? 0)) / 2;
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !tree) return;
    const rootNodes = [...tree.nodes]
      .filter((n) => n.parentId === null)
      .sort((a, b) => a.ordering - b.ordering);
    const oldIndex = rootNodes.findIndex((n) => n.id === active.id);
    const newIndex = rootNodes.findIndex((n) => n.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(rootNodes, oldIndex, newIndex);
    const targetIndex = reordered.findIndex((n) => n.id === active.id);
    const newOrdering = computeOrdering(
      reordered.filter((n) => n.id !== active.id),
      targetIndex
    );
    const next = tree.nodes.map((n) =>
      n.id === active.id ? { ...n, ordering: newOrdering } : n
    );
    setTree({ ...tree, nodes: next });
    const response = await fetch(
      `/api/settings/journal-guides/${code}/nodes/${active.id}/move`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: null, ordering: newOrdering }),
      }
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      toast.error(data?.error || t("moveNodeFailed"));
      await refresh();
      return;
    }
    setTree(data.tree);
    startTransition(() => router.refresh());
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  return (
    <div className="space-y-6">
      {/* Тёмный hero снят: он занимал первый экран и повторял название,
          которое уже есть в PageNav. Оставляем строку-заголовок и главное
          действие рядом с ним. */}
      <PageHeader
        eyebrow={t("eyebrow")}
        title={journalName}
        description={t("description")}
        actions={
          <Button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
          >
            <Plus className="size-4" />
            {t("addStep")}
          </Button>
        }
      />

      {tree === null || tree.nodes.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <BookOpen className="size-5" />
          </div>
          <div className="mt-4 text-[15px] font-medium text-[#0b1024]">
            {t("emptyTitle")}
          </div>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] text-[#6f7282]">
            {t("emptyBody")}
          </p>
          <div className="mt-5 flex justify-center">
            <Button
              type="button"
              onClick={() => setAddOpen(true)}
              className="h-10 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]"
            >
              <Plus className="size-4" />
              {t("addFirstStep")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border border-[#ececf4] bg-white p-3 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={flatNodes.map((n) => n.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-2">
                {flatNodes.map((node, index) => (
                  <SortableGuideRow
                    key={node.id}
                    node={node}
                    index={index}
                    depth={depthOf(node, flatNodes)}
                    onEdit={() => setEditingNode(node)}
                    onDelete={() => setConfirmDelete(node)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          <p className="mt-3 px-1 text-[12px] text-[#9b9fb3]">
            {t.rich("dragHint", {
              grip: () => (
                <GripVertical className="inline size-3 align-text-bottom" />
              ),
            })}
          </p>
        </div>
      )}

      <AddGuideDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        code={code}
        onCreated={async () => {
          setAddOpen(false);
          await refresh();
        }}
      />

      <EditGuideDialog
        open={editingNode !== null}
        node={editingNode}
        code={code}
        onOpenChange={(value) => {
          if (!value) setEditingNode(null);
        }}
        onSaved={async () => {
          setEditingNode(null);
          await refresh();
        }}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        variant="danger"
        title={t("deleteTitle")}
        description={
          confirmDelete
            ? t("deleteDescription", { title: confirmDelete.title })
            : ""
        }
        confirmLabel={t("delete")}
        onConfirm={async () => {
          if (confirmDelete) {
            await handleDelete(confirmDelete);
          }
        }}
      />
    </div>
  );
}

function SortableGuideRow({
  node,
  index,
  depth,
  onEdit,
  onDelete,
}: {
  node: GuideNode;
  index: number;
  depth: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("settingsUi.guideTreeEditor");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    marginLeft: `${depth * 24}px`,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`rounded-2xl border bg-white p-4 transition-colors ${
        isDragging
          ? "border-[#5566f6] bg-[#f5f6ff] shadow-[0_16px_40px_-24px_rgba(85,102,246,0.55)]"
          : "border-[#ececf4] hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={t("drag")}
          className="mt-0.5 flex size-7 shrink-0 cursor-grab items-center justify-center rounded-lg text-[#9b9fb3] hover:bg-[#f5f6ff] hover:text-[#5566f6] active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[12px] font-semibold text-[#3848c7]">
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-medium text-[#0b1024]">
              {node.title || t("untitled")}
            </span>
            {node.photoUrl ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[11px] text-[#3848c7]">
                <ImageIcon className="size-3" />
                {t("photo")}
              </span>
            ) : null}
          </div>
          {node.detail ? (
            <p className="mt-1 line-clamp-3 whitespace-pre-line text-[13px] text-[#6f7282]">
              {node.detail}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title={t("edit")}
            onClick={onEdit}
            className="h-8 rounded-xl px-2 text-[#6f7282] hover:bg-[#f5f6ff] hover:text-[#5566f6]"
          >
            <Settings2 className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="h-8 rounded-xl px-2 text-[#a13a32] hover:bg-[#fff4f2]"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </li>
  );
}

function AddGuideDialog({
  open,
  onOpenChange,
  code,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  code: string;
  onCreated: () => void;
}) {
  const t = useTranslations("settingsUi.guideTreeEditor");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/settings/journal-guides/${code}/nodes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentId: null,
            title: title.trim(),
            detail: detail.trim() || null,
            photoUrl: photoUrl.trim() || null,
          }),
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(data?.error || t("addFailed"));
        return;
      }
      toast.success(t("stepAdded"));
      setTitle("");
      setDetail("");
      setPhotoUrl("");
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <JournalSettingsModal
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setTitle("");
          setDetail("");
          setPhotoUrl("");
        }
        onOpenChange(value);
      }}
      title={t("addDialogTitle")}
      description={t("addDialogDescription")}
      size="md"
      isSaving={busy}
      saveDisabled={!title.trim()}
      onSave={handleSave}
      onCancel={() => onOpenChange(false)}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("titleLabel")}
          </Label>
          <Input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("titlePlaceholder")}
            className="h-11 rounded-2xl border-[#dcdfed] px-4 text-[15px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("detailLabelMultiline")}
          </Label>
          <Textarea
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            placeholder={t("detailPlaceholder")}
            className="min-h-[140px] rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("photoUrlOptional")}
          </Label>
          <Input
            value={photoUrl}
            onChange={(event) => setPhotoUrl(event.target.value)}
            placeholder="https://..."
            type="url"
            className="h-11 rounded-2xl border-[#dcdfed] px-4 text-[15px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
          <p className="text-[12px] text-[#9b9fb3]">
            {t("photoHint")}
          </p>
        </div>
      </div>
    </JournalSettingsModal>
  );
}

function EditGuideDialog({
  open,
  node,
  code,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  node: GuideNode | null;
  code: string;
  onOpenChange: (value: boolean) => void;
  onSaved: () => void;
}) {
  const t = useTranslations("settingsUi.guideTreeEditor");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && node) {
      setTitle(node.title);
      setDetail(node.detail ?? "");
      setPhotoUrl(node.photoUrl ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, node?.id]);

  if (!node) return null;

  async function handleSave() {
    if (!title.trim() || !node) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/settings/journal-guides/${code}/nodes/${node.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            detail: detail.trim() || null,
            photoUrl: photoUrl.trim() || null,
          }),
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(data?.error || t("saveFailed"));
        return;
      }
      toast.success(t("stepSaved"));
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <JournalSettingsModal
      open={open}
      onOpenChange={onOpenChange}
      title={t("editDialogTitle")}
      description={t("editDialogDescription")}
      size="md"
      isSaving={busy}
      saveDisabled={!title.trim()}
      onSave={handleSave}
      onCancel={() => onOpenChange(false)}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("titleLabel")}
          </Label>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-11 rounded-2xl border-[#dcdfed] px-4 text-[15px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("detailLabel")}
          </Label>
          <Textarea
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            className="min-h-[140px] rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("photoUrl")}
          </Label>
          <Input
            value={photoUrl}
            onChange={(event) => setPhotoUrl(event.target.value)}
            placeholder="https://..."
            type="url"
            className="h-11 rounded-2xl border-[#dcdfed] px-4 text-[15px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
      </div>
    </JournalSettingsModal>
  );
}
