"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Camera,
  Check,
  ClipboardCheck,
  GripVertical,
  ListTree,
  MessageSquare,
  PenLine,
  Pin,
  Plus,
  Settings2,
  Sparkles,
  Split,
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
import type { PipelineNode, PipelineTree } from "@/lib/journal-pipeline-tree";

type FieldDef = { key: string; label: string };

type Props = {
  code: string;
  journalName: string;
  fields: FieldDef[];
  initialTree: PipelineTree | null;
};

function flattenTree(nodes: PipelineNode[]): PipelineNode[] {
  // root nodes first, then children grouped after their parent in DFS order
  const byParent = new Map<string | null, PipelineNode[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.ordering - b.ordering);
  }
  const result: PipelineNode[] = [];
  function walk(parentId: string | null) {
    for (const node of byParent.get(parentId) ?? []) {
      result.push(node);
      walk(node.id);
    }
  }
  walk(null);
  return result;
}

function depthOf(node: PipelineNode, all: PipelineNode[]): number {
  let depth = 0;
  let current: PipelineNode | undefined = node;
  while (current?.parentId) {
    current = all.find((n) => n.id === current!.parentId);
    if (!current) break;
    depth++;
    if (depth > 5) break;
  }
  return depth;
}

function SortableNodeRow({
  node,
  index,
  depth,
  onEdit,
  onDelete,
  onSplit,
  onAddSubtask,
}: {
  node: PipelineNode;
  index: number;
  depth: number;
  onEdit: () => void;
  onDelete: () => void;
  onSplit: () => void;
  onAddSubtask: () => void;
}) {
  const t = useTranslations("settingsUi.pipelineTreeEditor");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    marginLeft: `${depth * 24}px`,
  };
  const isPinned = node.kind === "pinned";

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
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-xl text-[12px] font-semibold ${
            isPinned ? "bg-[#5566f6] text-white" : "bg-[#eef1ff] text-[#3848c7]"
          }`}
        >
          {isPinned ? <Pin className="size-4" /> : index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-medium text-[#0b1024]">
              {node.title || t("untitled")}
            </span>
            {isPinned ? (
              <span className="rounded-full bg-[#eef1ff] px-2.5 py-0.5 font-mono text-[11px] text-[#3848c7]">
                {node.linkedFieldKey}
              </span>
            ) : (
              <span className="rounded-full bg-[#fafbff] px-2.5 py-0.5 text-[11px] text-[#6f7282]">
                custom
              </span>
            )}
            {node.photoMode !== "none" ? (
              <span className="rounded-full bg-[#fff4f2] px-2.5 py-0.5 text-[11px] text-[#a13a32]">
                {t("photoModeBadge", { mode: node.photoMode })}
              </span>
            ) : null}
            {node.requireComment ? (
              <span className="rounded-full bg-[#fff4f2] px-2.5 py-0.5 text-[11px] text-[#a13a32]">
                {t("commentRequired")}
              </span>
            ) : null}
          </div>
          {node.detail ? (
            <p className="mt-1 line-clamp-2 text-[13px] text-[#6f7282]">
              {node.detail}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          {/* Limit nesting к depth 2 (root=0, child=1, grandchild=2 max). */}
          {depth < 2 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title={t("addSubstep")}
              onClick={onAddSubtask}
              className="h-8 rounded-xl px-2 text-[#6f7282] hover:bg-[#f5f6ff] hover:text-[#5566f6]"
            >
              <Plus className="size-4" />
            </Button>
          ) : null}
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
          {isPinned ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title={t("splitTitle")}
              onClick={onSplit}
              className="h-8 rounded-xl px-2 text-[#6f7282] hover:bg-[#f5f6ff] hover:text-[#5566f6]"
            >
              <Split className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="h-8 rounded-xl px-2 text-[#a13a32] hover:bg-[#fff4f2]"
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

export function TreeEditorClient({
  code,
  journalName,
  fields,
  initialTree,
}: Props) {
  const t = useTranslations("settingsUi.pipelineTreeEditor");
  const router = useRouter();
  const [tree, setTree] = useState<PipelineTree | null>(initialTree);
  const [, startTransition] = useTransition();

  const [seedOpen, setSeedOpen] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addParentId, setAddParentId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PipelineNode | null>(null);
  const [confirmSplit, setConfirmSplit] = useState<PipelineNode | null>(null);
  const [confirmClearCustom, setConfirmClearCustom] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [editingNode, setEditingNode] = useState<PipelineNode | null>(null);

  const flatNodes = useMemo(
    () => (tree?.nodes ? flattenTree(tree.nodes) : []),
    [tree?.nodes]
  );
  const customNodeCount = flatNodes.filter((n) => n.kind === "custom").length;

  async function refresh() {
    const response = await fetch(
      `/api/settings/journal-pipelines/${code}`,
      { method: "GET", cache: "no-store" }
    );
    const data = (await response.json().catch(() => null)) as
      | { tree: PipelineTree | null }
      | null;
    if (data) setTree(data.tree);
    startTransition(() => router.refresh());
  }

  async function handleSeed() {
    setSeedBusy(true);
    try {
      const response = await fetch(
        `/api/settings/journal-pipelines/${code}/seed`,
        { method: "POST" }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(data?.error || t("seedFailed"));
        return;
      }
      setTree(data.tree);
      toast.success(
        t("seedCreated", { count: data.created?.length ?? 0 })
      );
      setSeedOpen(false);
      startTransition(() => router.refresh());
    } finally {
      setSeedBusy(false);
    }
  }

  async function handleDelete(node: PipelineNode) {
    const response = await fetch(
      `/api/settings/journal-pipelines/${code}/nodes/${node.id}`,
      { method: "DELETE" }
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      toast.error(data?.error || t("deleteNodeFailed"));
      return;
    }
    setTree(data.tree);
    toast.success(t("nodeDeleted"));
    setConfirmDelete(null);
    startTransition(() => router.refresh());
  }

  async function handleSplit(node: PipelineNode) {
    const response = await fetch(
      `/api/settings/journal-pipelines/${code}/nodes/${node.id}/split`,
      { method: "POST" }
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      toast.error(data?.error || t("splitFailed"));
      return;
    }
    setTree(data.tree);
    toast.success(t("nodeSplit"));
    startTransition(() => router.refresh());
  }

  async function handleClearCustom() {
    const response = await fetch(
      `/api/settings/journal-pipelines/${code}/clear-custom`,
      { method: "POST" }
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      toast.error(data?.error || t("clearCustomFailed"));
      return;
    }
    setTree(data.tree);
    toast.success(
      data.removed
        ? t("customRemoved", { count: data.removed })
        : t("cleared")
    );
    setConfirmClearCustom(false);
    startTransition(() => router.refresh());
  }

  async function handleClearAll() {
    const response = await fetch(
      `/api/settings/journal-pipelines/${code}/clear-all`,
      { method: "POST" }
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      toast.error(data?.error || t("clearAllFailed"));
      return;
    }
    setTree(data.tree);
    toast.success(
      data.removed
        ? t("nodesRemoved", { count: data.removed })
        : t("treeCleared")
    );
    setConfirmClearAll(false);
    startTransition(() => router.refresh());
  }

  /// Вычисляем новое значение `ordering` после drop'а.
  /// Если узел пришёл в начало — берём `firstOrdering / 2`. В конец —
  /// `lastOrdering + 1024`. В середину — `(prev + next) / 2`. Float-ordering
  /// в schema позволяет ⊃100 раз вставлять без коллизии прежде чем
  /// потребуется reindexing.
  function computeOrdering(
    siblings: PipelineNode[],
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

    // siblings = root-level узлы (parentId === null), отсортированные по ordering
    const rootNodes = [...tree.nodes]
      .filter((n) => n.parentId === null)
      .sort((a, b) => a.ordering - b.ordering);
    const oldIndex = rootNodes.findIndex((n) => n.id === active.id);
    const newIndex = rootNodes.findIndex((n) => n.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Новый список после move (для определения соседей)
    const reordered = arrayMove(rootNodes, oldIndex, newIndex);
    const targetIndex = reordered.findIndex((n) => n.id === active.id);
    const newOrdering = computeOrdering(
      reordered.filter((n) => n.id !== active.id),
      targetIndex
    );

    // Optimistic UI: меняем local state сразу
    const next = tree.nodes.map((n) =>
      n.id === active.id ? { ...n, ordering: newOrdering } : n
    );
    setTree({ ...tree, nodes: next });

    const response = await fetch(
      `/api/settings/journal-pipelines/${code}/nodes/${active.id}/move`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: null, ordering: newOrdering }),
      }
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      toast.error(data?.error || t("moveNodeFailed"));
      // Rollback
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
      {/* Тёмный hero снят: баннер съедал первый экран и дублировал название
          из PageNav. Оба действия перенесены в actions заголовка. */}
      <PageHeader
        eyebrow="Pipeline (beta)"
        title={journalName}
        description={t("description")}
        actions={
          <>
            {tree && tree.nodes.length > 0 ? (
              <Button
                type="button"
                onClick={() => {
                  setAddParentId(null);
                  setAddOpen(true);
                }}
                className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
              >
                <Plus className="size-4" />
                {t("addStep")}
              </Button>
            ) : null}
            {tree && tree.nodes.some((n) => n.kind === "pinned") ? null : (
              <Button
                type="button"
                onClick={() => setSeedOpen(true)}
                disabled={fields.length === 0}
                className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                title={
                  fields.length === 0
                    ? t("noColumns")
                    : undefined
                }
              >
                <Sparkles className="size-4 text-[#5566f6]" />
                {t("seedFromColumns")}
              </Button>
            )}
          </>
        }
      />

      {tree && tree.nodes.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <Sparkles className="size-5" />
          </div>
          <div className="mt-4 text-[15px] font-medium text-[#0b1024]">
            {t("emptyTitle")}
          </div>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] text-[#6f7282]">
            {t("emptyBody")}
          </p>
        </div>
      ) : tree === null ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <ListTree className="size-5" />
          </div>
          <div className="mt-4 text-[15px] font-medium text-[#0b1024]">
            {t("noTemplateTitle")}
          </div>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] text-[#6f7282]">
            {t("noTemplateBody")}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              onClick={() => setSeedOpen(true)}
              disabled={fields.length === 0}
              className="h-10 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]"
            >
              <Sparkles className="size-4" />
              {t("seedFromColumnsShort")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAddParentId(null);
                setAddOpen(true);
              }}
              className="h-10 rounded-2xl border-[#dcdfed] bg-white px-4 text-[14px] text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <Plus className="size-4" />
              {t("addCustomStep")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
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
                    <SortableNodeRow
                      key={node.id}
                      node={node}
                      index={index}
                      depth={depthOf(node, flatNodes)}
                      onEdit={() => setEditingNode(node)}
                      onDelete={() => setConfirmDelete(node)}
                      onSplit={() => setConfirmSplit(node)}
                      onAddSubtask={() => {
                        setAddParentId(node.id);
                        setAddOpen(true);
                      }}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
            <div className="mt-3 flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] leading-snug text-[#9b9fb3]">
                {t.rich("dragHint", {
                  grip: () => (
                    <GripVertical className="inline size-3 align-text-bottom" />
                  ),
                })}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {customNodeCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setConfirmClearCustom(true)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#fff4f2] px-3 py-1 text-[12px] font-medium text-[#a13a32] hover:bg-[#ffe5e1]"
                    title={t("clearCustomHint")}
                  >
                    <Trash2 className="size-3" />
                    {t("clearCustomButton", { count: customNodeCount })}
                  </button>
                ) : null}
                {flatNodes.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#fed4ce] bg-[#fff4f2] px-3 py-1 text-[12px] font-semibold text-[#a13a32] hover:border-[#a13a32]/30 hover:bg-[#ffe5e1]"
                    title={t("clearAllHint", { count: flatNodes.length, word: t("clearAllWord") })}
                  >
                    <Trash2 className="size-3" />
                    {t("clearAllButton", { count: flatNodes.length })}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <WizardPreview nodes={flatNodes} />
        </div>
      )}

      <SeedConfirmDialog
        open={seedOpen}
        onOpenChange={setSeedOpen}
        fieldsCount={fields.length}
        onConfirm={handleSeed}
        busy={seedBusy}
      />

      <AddCustomDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        parentId={addParentId}
        code={code}
        onCreated={async () => {
          setAddOpen(false);
          await refresh();
        }}
      />

      <EditNodeDialog
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

      <ConfirmDialog
        open={confirmClearCustom}
        onClose={() => setConfirmClearCustom(false)}
        variant="danger"
        title={t("clearCustomTitle")}
        description={
          <span>
            {t.rich("clearCustomDescription", {
              count: customNodeCount,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </span>
        }
        bullets={[
          {
            label: t("clearCustomBullet1"),
          },
          {
            label: t("clearCustomBullet2"),
          },
          {
            label: t("clearCustomBullet3"),
            tone: "warn",
          },
        ]}
        typeToConfirm={t("clearCustomWord")}
        confirmLabel={t("clear")}
        onConfirm={handleClearCustom}
      />

      <ConfirmDialog
        open={confirmClearAll}
        onClose={() => setConfirmClearAll(false)}
        variant="danger"
        title={t("clearAllTitle")}
        description={
          <span>
            {t.rich("clearAllDescription", {
              count: flatNodes.length,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </span>
        }
        bullets={[
          {
            label: t("clearAllBullet1"),
          },
          {
            label: t("clearAllBullet2"),
            tone: "warn",
          },
          {
            label: t("clearAllBullet3"),
            tone: "warn",
          },
        ]}
        typeToConfirm={t("clearAllWord")}
        confirmLabel={t("clearAllConfirm")}
        onConfirm={handleClearAll}
      />

      <ConfirmDialog
        open={confirmSplit !== null}
        onClose={() => setConfirmSplit(null)}
        variant="info"
        title={t("splitDialogTitle")}
        description={
          confirmSplit ? (
            <span>
              {t("splitDescription", { title: confirmSplit.title })}
            </span>
          ) : (
            ""
          )
        }
        bullets={[
          {
            label: t("splitBullet1"),
          },
          {
            label: t("splitBullet2"),
          },
          {
            label: t("splitBullet3"),
            tone: "info",
          },
        ]}
        confirmLabel={t("split")}
        onConfirm={async () => {
          if (confirmSplit) {
            await handleSplit(confirmSplit);
            setConfirmSplit(null);
          }
        }}
      />
    </div>
  );
}

/**
 * Read-only превью того, как сотрудник увидит pipeline в TasksFlow / Mini App.
 * Не интерактивный — все шаги в expanded-виде показывают title, detail, hint
 * и flag-bagde'ы (фото / комментарий / подпись). Цель: дать менеджеру
 * мгновенный визуальный feedback после edit/reorder/split в дереве.
 *
 * Воспроизводит layout `<PipelineWizard>` из task-fill-client.tsx:
 * progress-bar шапка → ol со step-карточками. Текущий шаг (1) показан
 * в indigo-current стиле, остальные — в lock-стиле.
 */
function WizardPreview({ nodes }: { nodes: PipelineNode[] }) {
  const t = useTranslations("settingsUi.pipelineTreeEditor");
  const total = nodes.length;
  return (
    <aside className="lg:sticky lg:top-6 lg:self-start">
      <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("previewTitle")}
          </div>
          <div className="rounded-full bg-white px-2.5 py-0.5 text-[11px] text-[#9b9fb3]">
            {t("previewSubtitle")}
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#dcdfed] bg-white px-4 py-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">
              <ClipboardCheck className="size-4 text-[#5566f6]" />
              {t("stepByStep")}
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[13px] font-semibold tabular-nums text-[#0b1024]">
                0/{total}
              </div>
              <div className="h-2 w-20 overflow-hidden rounded-full bg-[#eef1ff]">
                <div className="h-full w-0 bg-gradient-to-r from-[#5566f6] to-[#7a5cff]" />
              </div>
            </div>
          </div>

          {total === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-white px-4 py-8 text-center text-[13px] text-[#9b9fb3]">
              {t("noPreviewSteps")}
            </div>
          ) : (
            <ol className="space-y-2.5">
              {nodes.map((node, index) => {
                const isCurrent = index === 0;
                // P1.7 — indent в preview (точно как в реальном wizard'е).
                const previewDepth = depthOf(node, nodes);
                const indentPx = previewDepth * 24;
                return (
                  <li
                    key={node.id}
                    style={indentPx ? { marginLeft: `${indentPx}px` } : undefined}
                    className={[
                      "rounded-2xl border transition-colors",
                      isCurrent
                        ? "border-[#5566f6]/40 bg-white shadow-[0_8px_24px_-12px_rgba(85,102,246,0.35)]"
                        : "border-[#ececf4] bg-white",
                    ].join(" ")}
                  >
                    <div className="flex items-start gap-3 p-4">
                      <div
                        className={[
                          "flex size-9 shrink-0 items-center justify-center rounded-xl text-[15px] font-semibold tabular-nums",
                          isCurrent
                            ? "bg-[#5566f6] text-white"
                            : "bg-[#eef1ff] text-[#9b9fb3]",
                        ].join(" ")}
                      >
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className={[
                            "text-[15px] font-semibold leading-snug",
                            isCurrent ? "text-[#0b1024]" : "text-[#9b9fb3]",
                          ].join(" ")}
                        >
                          {node.title || t("untitled")}
                        </div>
                        {isCurrent && node.detail ? (
                          <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed text-[#3c4053]">
                            {node.detail}
                          </p>
                        ) : null}
                        {isCurrent && node.hint ? (
                          <p className="mt-2 rounded-xl bg-[#f5f6ff] px-3 py-2 text-[12.5px] leading-snug text-[#6f7282]">
                            💡 {node.hint}
                          </p>
                        ) : null}
                        {isCurrent ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {node.photoMode === "required" ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#fff4f2] px-2.5 py-0.5 text-[11px] font-medium text-[#a13a32]">
                                <Camera className="size-3" />
                                {t("photoRequired")}
                              </span>
                            ) : node.photoMode === "optional" ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[11px] text-[#3848c7]">
                                <Camera className="size-3" />
                                {t("photoOptional")}
                              </span>
                            ) : null}
                            {node.requireComment ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#fff4f2] px-2.5 py-0.5 text-[11px] font-medium text-[#a13a32]">
                                <MessageSquare className="size-3" />
                                {t("comment")}
                              </span>
                            ) : null}
                            {node.requireSignature ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#fff4f2] px-2.5 py-0.5 text-[11px] font-medium text-[#a13a32]">
                                <PenLine className="size-3" />
                                {t("signature")}
                              </span>
                            ) : null}
                            {node.kind === "pinned" && node.linkedFieldKey ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#eef1ff] px-2.5 py-0.5 font-mono text-[11px] text-[#3848c7]">
                                → {node.linkedFieldKey}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {isCurrent ? (
                      <div className="border-t border-[#ececf4] px-4 py-3">
                        <div className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6]/30 px-4 text-[13px] font-medium text-white opacity-50">
                          <Check className="size-4" />
                          {t("done")}
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </aside>
  );
}

function SeedConfirmDialog({
  open,
  onOpenChange,
  fieldsCount,
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  fieldsCount: number;
  onConfirm: () => void;
  busy: boolean;
}) {
  const t = useTranslations("settingsUi.pipelineTreeEditor");
  return (
    <JournalSettingsModal
      open={open}
      onOpenChange={onOpenChange}
      title={t("seedDialogTitle")}
      description={t("seedDialogDescription", { count: fieldsCount })}
      size="md"
      isSaving={busy}
      onSave={onConfirm}
      onCancel={() => onOpenChange(false)}
    >
      <div className="rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4 text-[13px] text-[#3c4053]">
        {t("seedDialogHint")}
      </div>
    </JournalSettingsModal>
  );
}

function AddCustomDialog({
  open,
  onOpenChange,
  parentId,
  code,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  parentId: string | null;
  code: string;
  onCreated: () => void;
}) {
  const t = useTranslations("settingsUi.pipelineTreeEditor");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [photoRequired, setPhotoRequired] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/settings/journal-pipelines/${code}/nodes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentId,
            title: title.trim(),
            detail: detail.trim() || null,
            photoMode: photoRequired ? "required" : "none",
          }),
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(data?.error || t("createNodeFailed"));
        return;
      }
      toast.success(t("nodeAdded"));
      setTitle("");
      setDetail("");
      setPhotoRequired(false);
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
          setPhotoRequired(false);
        }
        onOpenChange(value);
      }}
      title={t("addCustomTitle")}
      description={t("addCustomDescription")}
      size="md"
      isSaving={busy}
      saveDisabled={!title.trim()}
      onSave={handleSave}
      onCancel={() => onOpenChange(false)}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("stepName")}
          </Label>
          <Input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("addCustomTitlePlaceholder")}
            className="h-11 rounded-2xl border-[#dcdfed] px-4 text-[15px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("detailOptional")}
          </Label>
          <Textarea
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            placeholder={t("detailPlaceholder")}
            className="min-h-[120px] rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <label className="flex items-center gap-3 rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-4 py-3">
          <input
            type="checkbox"
            checked={photoRequired}
            onChange={(event) => setPhotoRequired(event.target.checked)}
            className="size-4 accent-[#5566f6]"
          />
          <div className="text-[13px] text-[#0b1024]">
            <div className="font-medium">{t("requirePhoto")}</div>
            <div className="text-[12px] text-[#6f7282]">
              {t("requirePhotoHint")}
            </div>
          </div>
        </label>
      </div>
    </JournalSettingsModal>
  );
}

function EditNodeDialog({
  open,
  node,
  code,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  node: PipelineNode | null;
  code: string;
  onOpenChange: (value: boolean) => void;
  onSaved: () => void;
}) {
  const t = useTranslations("settingsUi.pipelineTreeEditor");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [hint, setHint] = useState("");
  const [photoMode, setPhotoMode] = useState<
    "none" | "optional" | "required"
  >("none");
  const [requireComment, setRequireComment] = useState(false);
  const [requireSignature, setRequireSignature] = useState(false);
  const [busy, setBusy] = useState(false);

  // Sync state with node when dialog opens.
  useNodeSync(node, open, (n) => {
    setTitle(n.title);
    setDetail(n.detail ?? "");
    setHint(n.hint ?? "");
    setPhotoMode(n.photoMode);
    setRequireComment(n.requireComment);
    setRequireSignature(n.requireSignature);
  });

  if (!node) return null;
  const isPinned = node.kind === "pinned";

  async function handleSave() {
    if (!title.trim() || !node) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/settings/journal-pipelines/${code}/nodes/${node.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            detail: detail.trim() || null,
            hint: hint.trim() || null,
            photoMode,
            requireComment,
            requireSignature,
          }),
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(data?.error || t("saveNodeFailed"));
        return;
      }
      toast.success(t("nodeSaved"));
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
      description={
        isPinned
          ? t("editPinnedDescription", { key: node.linkedFieldKey ?? "" })
          : t("editCustomDescription")
      }
      size="md"
      isSaving={busy}
      saveDisabled={!title.trim()}
      onSave={handleSave}
      onCancel={() => onOpenChange(false)}
    >
      <div className="space-y-5">
        {isPinned ? (
          <div className="rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[13px] text-[#3c4053]">
            📌 <span className="font-medium">linkedFieldKey:</span>{" "}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[12px] text-[#3848c7]">
              {node.linkedFieldKey ?? "—"}
            </code>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("stepName")}
          </Label>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-11 rounded-2xl border-[#dcdfed] px-4 text-[15px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("detail")}
          </Label>
          <Textarea
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            placeholder={t("detailPlaceholder")}
            className="min-h-[120px] rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("hintLabel")}
          </Label>
          <Input
            value={hint}
            onChange={(event) => setHint(event.target.value)}
            placeholder={t("hintPlaceholder")}
            className="h-11 rounded-2xl border-[#dcdfed] px-4 text-[15px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {t("photoProof")}
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {(["none", "optional", "required"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPhotoMode(mode)}
                className={`rounded-2xl border px-3 py-2.5 text-[13px] font-medium transition-colors ${
                  photoMode === mode
                    ? "border-[#5566f6] bg-[#f5f6ff] text-[#3848c7]"
                    : "border-[#dcdfed] bg-white text-[#6f7282] hover:border-[#5566f6]/40"
                }`}
              >
                {mode === "none"
                  ? t("photoNone")
                  : mode === "optional"
                    ? t("photoOptionalMode")
                    : t("photoRequiredMode")}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-3 rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-4 py-3">
          <input
            type="checkbox"
            checked={requireComment}
            onChange={(event) => setRequireComment(event.target.checked)}
            className="size-4 accent-[#5566f6]"
          />
          <div className="text-[13px] text-[#0b1024]">
            <div className="font-medium">{t("requireComment")}</div>
            <div className="text-[12px] text-[#6f7282]">
              {t("requireCommentHint")}
            </div>
          </div>
        </label>

        <label className="flex items-center gap-3 rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-4 py-3">
          <input
            type="checkbox"
            checked={requireSignature}
            onChange={(event) => setRequireSignature(event.target.checked)}
            className="size-4 accent-[#5566f6]"
          />
          <div className="text-[13px] text-[#0b1024]">
            <div className="font-medium">{t("requireSignature")}</div>
            <div className="text-[12px] text-[#6f7282]">
              {t("requireSignatureHint")}
            </div>
          </div>
        </label>
      </div>
    </JournalSettingsModal>
  );
}

/// Вытягивает поля узла в state редактора при каждом открытии.
/// Без него редактор покажет старые значения если открыть → закрыть → открыть.
function useNodeSync(
  node: PipelineNode | null,
  open: boolean,
  apply: (n: PipelineNode) => void
) {
  useEffect(() => {
    if (open && node) apply(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, node?.id]);
}

