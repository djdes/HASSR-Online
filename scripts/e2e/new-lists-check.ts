// Moved here from .agent/tasks/multi-org-followups-c2-2026-11-20/raw/new-lists-check.ts (series C2); that file is now a wrapper that runs this one, and its logs stay as that series' evidence.
/*
 * Series C2, items Р8.1 («Журналы»), Р8.4 («Чек-листы») and Р8.5 (the new lists everywhere) —
 * AC2, AC5, AC6 — end to end against the local DB.
 *
 * 1. «Журналы» (AC2): linking two organizations overwrites nobody's settings; reading the
 *    settings does not save a journal-controls choice. Then A turns a journal off, sets
 *    automation by journal and the automation switches → B gets the same disabled codes, legacy
 *    auto list, automation flags and switches; B's responsible people by journal, sensor-camera
 *    and brakerage settings and B's point (own journal set and automation) are untouched; the
 *    autofill flag of B's open org-level document follows, a point document does not. An edit in
 *    B goes back to A; an idle run changes nothing.
 * 2. «Чек-листы» (AC5): a template reaches B without its assignments and without file
 *    references; an archived one does not; a same-title template of B is linked, not duplicated,
 *    and keeps its content until a real edit; edits reach B (version bumped, B's own references
 *    kept); a template B archived is not created again.
 * 3. Another company (AC6): with «Журналы» and «Чек-листы» allowed it gets the templates and the
 *    owner's journal edits; its own edits do not reach the owner; its new template reaches the
 *    owner. A one-off transfer to another company: templates and journal settings arrive; undo
 *    removes the templates and restores the previous journal settings (series D, Р10).
 * 4. Own one-off transfer: preview, transfer, the recent-transfers list marks journals as replaced
 *    (undoable since series D, Р10), undo deletes unused templates, keeps a used one and restores the
 *    settings; a journals-only transfer is undone too; the same settings again transfer nothing.
 *    (Updated in series D: before Р10 a «Журналы» transfer could not be undone.)
 */
import "./env";

import { db } from "@/lib/db";
import { createExchangeRequest, decideExchangeRequest } from "@/lib/directory-exchange/requests.server";
import { runDirectoryExchange, transferOnce, transferPreview } from "@/lib/directory-exchange/run.server";
import { ensureExchangeCabinet, loadExchangeState, saveExchangeMembers } from "@/lib/directory-exchange/settings.server";
import { summaryTotals, type ExchangeSummary } from "@/lib/directory-exchange/summary";
import { listRecentTransfers, undoTransfer } from "@/lib/directory-exchange/transfer-undo.server";
import { parseJournalAutomationJson } from "@/lib/journal-automation";
import { peekJournalControls, updateJournalControls } from "@/lib/journal-controls.server";

const TAG = `nlchk${Date.now().toString(36)}`;
const DAY = 86_400_000;
const orgIds: string[] = [];
const accountIds: string[] = [];
let failed = 0;
let passed = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
}

/* Письма в dev не уходят, а пишутся в журнал — глушим его. */
console.info = () => undefined;

const PAID = { subscriptionPlan: "standard", subscriptionEnd: new Date(Date.now() + 30 * DAY), planPoints: 10, planCycle: "month" };

async function makeOrg(name: string, accountId: string | null = null) {
  const org = await db.organization.create({ data: { name: `${name} ${TAG}`, type: "restaurant", accountId } });
  orgIds.push(org.id);
  return org;
}

async function makeOwner(orgId: string, label: string) {
  const owner = await db.user.create({
    data: { email: `${TAG}-${label}@example.test`, name: `Владелец ${label}`, passwordHash: "not-a-real-hash", role: "manager", organizationId: orgId },
  });
  const account = await db.account.create({ data: { ownerUserId: owner.id, ...PAID } });
  accountIds.push(account.id);
  await db.organization.update({ where: { id: orgId }, data: { accountId: account.id } });
  await db.organizationMember.create({ data: { userId: owner.id, organizationId: orgId, role: "owner" } });
  return { owner, account, actor: { userId: owner.id, userName: owner.name } };
}

async function join(ownerId: string, orgId: string) {
  await db.organizationMember.create({ data: { userId: ownerId, organizationId: orgId, role: "owner" } });
}

/** JSON with sorted keys: jsonb does not keep the key order. */
function canon(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === "object"
        ? Object.fromEntries(Object.keys(item as Record<string, unknown>).sort().map((key) => [key, sort((item as Record<string, unknown>)[key])]))
        : item;
  return JSON.stringify(sort(value));
}
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const totals = (summary: ExchangeSummary | undefined) => summaryTotals(summary ?? { organizations: [], notes: [] });
const of = (summary: ExchangeSummary | undefined, orgId: string) => summary?.organizations.find((o) => o.organizationId === orgId)?.kinds;
const sorted = (value: unknown) => (Array.isArray(value) ? [...value].map(String).sort() : value);

const controlsKey = (orgId: string) => `org-journal-controls:${orgId}`;

/** Journal settings of an organization: the org fields and the stored controls. */
async function settingsOf(orgId: string) {
  const org = await db.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { disabledJournalCodes: true, autoJournalCodes: true, journalAutomationJson: true },
  });
  const stored = await db.platformSetting.findUnique({ where: { key: controlsKey(orgId) } });
  return {
    disabled: sorted(org.disabledJournalCodes),
    auto: sorted(org.autoJournalCodes),
    automation: org.journalAutomationJson,
    controls: stored ? JSON.parse(stored.value) : null,
  };
}
const flagsOf = (raw: unknown) =>
  Object.fromEntries(
    Object.entries(parseJournalAutomationJson(raw)).map(([code, value]) => [code, { autoCreate: value.autoCreate, autoFill: value.autoFill }]),
  );

/** A valid checklist definition; `references` — sample files of the first question. */
function definition(questions: string[], references?: string[]) {
  return {
    description: "",
    sections: [
      {
        id: "s1",
        title: "Раздел",
        active: true,
        categories: [
          {
            id: "c1",
            title: "Категория",
            active: true,
            questions: questions.map((title, index) => ({
              id: `q${index + 1}`,
              title,
              description: "",
              type: "yes_no",
              active: true,
              required: false,
              weight: 1,
              min: 0,
              max: 10,
              options: [],
              ...(index === 0 && references ? { references } : {}),
            })),
          },
        ],
      },
    ],
  };
}
type Definition = ReturnType<typeof definition>;
const questionTitles = (raw: unknown) => (raw as Definition).sections.flatMap((section) => section.categories.flatMap((category) => category.questions.map((q) => q.title)));
const hasReferences = (raw: unknown) => JSON.stringify(raw).includes("\"references\"");
const templates = (orgId: string) =>
  db.checklistTemplate.findMany({ where: { organizationId: orgId, archived: false }, orderBy: { title: "asc" }, select: { id: true, title: true, definition: true, version: true } });
const template = (orgId: string, title: string) => db.checklistTemplate.findFirst({ where: { organizationId: orgId, title, archived: false } });

async function main() {
  const hygiene = await db.journalTemplate.findFirstOrThrow({ where: { code: "hygiene" }, select: { id: true } });

  /* ── аккаунт X: организации A и B ── */
  const a = await makeOrg("Первая");
  const x = await makeOwner(a.id, "x");
  const b = await makeOrg("Вторая", x.account.id);
  await join(x.owner.id, b.id);
  const cookB = await db.user.create({ data: { email: `${TAG}-cook@example.test`, name: "Повар Б", passwordHash: "", role: "cook", organizationId: b.id } });

  // A: one journal off, nothing automated, controls saved «off».
  await db.organization.update({ where: { id: a.id }, data: { disabledJournalCodes: ["health_check"], autoJournalCodes: [], journalAutomationJson: {} } });
  await updateJournalControls(a.id, { automation: { enabled: false, autoFill: false, autoCreate: false, copyYesterday: false, closeDayAutofill: false, catchUp: false, pastDays: false, pastDaysLimit: 7 } });
  // B: its own set, a responsible person for hygiene, no saved controls yet; a point WITHOUT its own journal settings
  // (an organization whose points keep their own set is left out of «Журналы» — org E below).
  await db.organization.update({
    where: { id: b.id },
    data: {
      disabledJournalCodes: ["med_books"],
      autoJournalCodes: [],
      journalAutomationJson: { hygiene: { autoCreate: false, autoFill: false, responsibles: { mode: "custom", responsibleUserId: cookB.id, verifierUserId: null } } },
    },
  });
  const pointB = await db.building.create({ data: { organizationId: b.id, name: "Точка Б" } });
  const pointBefore = canon(await db.building.findUniqueOrThrow({ where: { id: pointB.id } }));
  const today = new Date();
  const docRange = { dateFrom: new Date(today.getTime() - 5 * DAY), dateTo: new Date(today.getTime() + 20 * DAY) };
  const docOrgB = await db.journalDocument.create({ data: { organizationId: b.id, templateId: hygiene.id, title: "Гигиена Б", ...docRange, autoFill: false } });
  const docPointB = await db.journalDocument.create({
    data: { organizationId: b.id, templateId: hygiene.id, title: "Гигиена точки Б", ...docRange, autoFill: false, buildingId: pointB.id },
  });

  // Checklists: A has an assigned template with a sample file, an archived one and one B has too (other case and spaces).
  const kitchenA = await db.checklistTemplate.create({
    data: { organizationId: a.id, title: "Проверка кухни", definition: definition(["Чисто?", "Есть мыло?"], ["file:sample0001abc"]) },
  });
  await db.checklistAssignment.create({
    data: {
      organizationId: a.id,
      templateId: kitchenA.id,
      targetKind: "user",
      targetId: x.owner.id,
      frequency: "daily",
      dueTime: "12:00",
      createdById: x.owner.id,
      createdByName: "Владелец x",
    },
  });
  await db.checklistTemplate.create({ data: { organizationId: a.id, title: "Старый архивный", definition: definition(["Был?"]), archived: true } });
  const sanitaryA = await db.checklistTemplate.create({ data: { organizationId: a.id, title: "Санитарный день", definition: definition(["Окна вымыты?"]) } });
  const sanitaryB = await db.checklistTemplate.create({ data: { organizationId: b.id, title: "санитарный  день", definition: definition(["Своё содержание Б?"]) } });

  const cabinet = await ensureExchangeCabinet(x.owner.id, x.account.id);
  orgIds.push(cabinet.id);
  const code = (await db.organization.findUnique({ where: { id: cabinet.id }, select: { serviceCode: true } }))!.serviceCode!;

  // Р8.5: the counts in the dialog know the new lists.
  const state = await loadExchangeState(x.owner.id, a.id, { sessionAllows: true });
  check(
    "Р8.5: exchange state counts the new lists (journals = 1 settings record, checklists = live templates)",
    state.counts.journals === 1 && state.counts.checklists === 2,
    state.counts,
  );

  await saveExchangeMembers({
    ownerUserId: x.owner.id,
    ownerName: x.owner.name,
    organizationId: a.id,
    members: [
      { organizationId: a.id, kinds: ["journals", "checklists"] },
      { organizationId: b.id, kinds: ["journals", "checklists"] },
    ],
  });
  const bBefore = await settingsOf(b.id);
  check("setup: B has no saved journal controls", bBefore.controls === null);
  const first = await runDirectoryExchange(cabinet.id, { actor: x.actor });

  /* ── AC2: журналы ── */
  console.log("--- AC2: «Журналы»");
  const settingsLinks = await db.directoryExchangeLink.findMany({ where: { masterOrganizationId: cabinet.id, entity: "journal_settings" } });
  check(
    "AC2: linking — both settings records in one group, ids are the organizations",
    settingsLinks.length === 2 && new Set(settingsLinks.map((link) => link.groupId)).size === 1 && settingsLinks.every((link) => link.entityId === link.organizationId),
    settingsLinks.map((link) => [link.organizationId === link.entityId, link.groupId]),
  );
  check("AC2: linking overwrites nobody's journal settings (0 updated in «Журналы»)", (of(first, b.id)?.journals.updated ?? -1) === 0 && (of(first, a.id)?.journals.updated ?? -1) === 0, of(first, b.id)?.journals);
  check("AC2: B's settings unchanged by linking", same(await settingsOf(b.id), bBefore));
  check("AC2: reading the settings does not save B's journal controls (read-only path)", (await db.platformSetting.findUnique({ where: { key: controlsKey(b.id) } })) === null);

  // B has its own sensor-camera choice: it must survive the exchange.
  await updateJournalControls(b.id, { sensorCamera: { cold_equipment_control: true }, brakerageSetup: { finished_product: "declined" } });
  // A: turns a journal off, automates hygiene, switches automation on.
  await db.organization.update({
    where: { id: a.id },
    data: {
      disabledJournalCodes: ["pest_control", "health_check"],
      autoJournalCodes: ["hygiene"],
      journalAutomationJson: { hygiene: { autoCreate: true, autoFill: true }, cleaning: { autoCreate: true, autoFill: false } },
    },
  });
  // «Правка прошлых дней» с глубиной (спецрежим, 2026-11-25) переезжает вместе с остальными переключателями.
  const switches = { enabled: true, autoFill: true, autoCreate: true, copyYesterday: false, closeDayAutofill: true, catchUp: false, pastDays: true, pastDaysLimit: 14 as const };
  await updateJournalControls(a.id, { automation: switches });
  const edit = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  const bAfter = await settingsOf(b.id);
  check("AC2: A's edit is one update in B's «Журналы»", of(edit, b.id)?.journals.updated === 1 && totals(edit).updated === 1, of(edit, b.id)?.journals);
  check("AC2: B has A's disabled journals", same(bAfter.disabled, ["health_check", "pest_control"]), bAfter.disabled);
  check("AC2: B has A's legacy auto-create list", same(bAfter.auto, ["hygiene"]), bAfter.auto);
  check(
    "AC2: B has A's automation flags by journal",
    same(flagsOf(bAfter.automation), { hygiene: { autoCreate: true, autoFill: true }, cleaning: { autoCreate: true, autoFill: false } }),
    bAfter.automation,
  );
  const bAutomation = parseJournalAutomationJson(bAfter.automation);
  check(
    "AC2: B's own responsible person for hygiene stays (people are not exchanged)",
    bAutomation.hygiene?.responsibles?.mode === "custom" && bAutomation.hygiene.responsibles.responsibleUserId === cookB.id,
    bAfter.automation,
  );
  const bControls = (await peekJournalControls(b.id)).controls;
  check("AC2: B's automation switches are A's", same(bControls.automation, switches), bControls.automation);
  check(
    "AC2: B's sensor-camera and brakerage choices are untouched",
    bControls.sensorCamera.cold_equipment_control === true && bControls.brakerageSetup.finished_product === "declined",
    bControls,
  );
  check("AC2: B's point (no own journal settings) is untouched", canon(await db.building.findUniqueOrThrow({ where: { id: pointB.id } })) === pointBefore);
  check(
    "AC2: autofill follows to B's open documents (the point has no own automation, so its document follows too)",
    (await db.journalDocument.findUniqueOrThrow({ where: { id: docOrgB.id } })).autoFill === true &&
      (await db.journalDocument.findUniqueOrThrow({ where: { id: docPointB.id } })).autoFill === true,
  );
  const idle = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("AC2: the next run is empty", totals(idle).created === 0 && totals(idle).updated === 0, totals(idle));

  // An edit in B goes back to A (both are the owner's organizations).
  await db.organization.update({ where: { id: b.id }, data: { disabledJournalCodes: ["health_check"] } });
  const back = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("AC2: B's edit (pest control back on) reaches A", same((await settingsOf(a.id)).disabled, ["health_check"]) && of(back, a.id)?.journals.updated === 1, (await settingsOf(a.id)).disabled);

  // An organization whose point keeps its own journal set takes no part in «Журналы»: the app keeps
  // "the organization disables only what all its own-set points disable", so the source value cannot be
  // written there (it would never match and would bounce back).
  const e = await makeOrg("Пятая", x.account.id);
  await join(x.owner.id, e.id);
  await db.organization.update({ where: { id: e.id }, data: { disabledJournalCodes: ["cleaning"], autoJournalCodes: [], journalAutomationJson: {} } });
  const pointE = await db.building.create({
    data: { organizationId: e.id, name: "Точка Е", disabledJournalCodes: ["cleaning"], autoJournalCodes: [], journalAutomationJson: { hygiene: { autoCreate: false, autoFill: false } } },
  });
  const eBefore = await settingsOf(e.id);
  const pointEBefore = canon(await db.building.findUniqueOrThrow({ where: { id: pointE.id } }));
  await saveExchangeMembers({ ownerUserId: x.owner.id, ownerName: x.owner.name, organizationId: a.id, members: [{ organizationId: e.id, kinds: ["journals"] }] });
  const withE = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("own-set points: E's journal settings untouched", same((await settingsOf(e.id)).disabled, eBefore.disabled) && same((await settingsOf(e.id)).auto, eBefore.auto));
  check("own-set points: E's point untouched", canon(await db.building.findUniqueOrThrow({ where: { id: pointE.id } })) === pointEBefore);
  check("own-set points: no «Журналы» link for E", (await db.directoryExchangeLink.count({ where: { masterOrganizationId: cabinet.id, organizationId: e.id, entity: "journal_settings" } })) === 0);
  check("own-set points: the summary explains it", withE.notes.some((note) => note.includes("«Пятая") && note.includes("своим набором журналов")), withE.notes);
  check("own-set points: nothing changed for A and B", totals(withE).updated === 0 && totals(withE).created === 0, totals(withE));
  await saveExchangeMembers({ ownerUserId: x.owner.id, ownerName: x.owner.name, organizationId: a.id, members: [{ organizationId: e.id, kinds: [] }] });

  /* ── AC5: чек-листы ── */
  console.log("--- AC5: «Чек-листы»");
  const kitchenB = await template(b.id, "Проверка кухни");
  check("AC5: the template reached B", Boolean(kitchenB) && of(first, b.id)?.checklists.created === 1, of(first, b.id)?.checklists);
  check("AC5: B's copy has the questions but no file references", Boolean(kitchenB) && same(questionTitles(kitchenB!.definition), ["Чисто?", "Есть мыло?"]) && !hasReferences(kitchenB!.definition), kitchenB?.definition);
  check("AC5: no assignments came with it", (await db.checklistAssignment.count({ where: { organizationId: b.id } })) === 0);
  check("AC5: the archived template is not transferred", (await db.checklistTemplate.count({ where: { organizationId: b.id, title: "Старый архивный" } })) === 0);
  const sanitaryLinks = await db.directoryExchangeLink.findMany({ where: { masterOrganizationId: cabinet.id, entity: "checklist_template", entityId: { in: [sanitaryA.id, sanitaryB.id] } } });
  check(
    "AC5: same title (case and spaces aside) — linked, not duplicated, B keeps its content",
    sanitaryLinks.length === 2 &&
      sanitaryLinks[0].groupId === sanitaryLinks[1].groupId &&
      (await db.checklistTemplate.count({ where: { organizationId: b.id, title: { contains: "анитарный", mode: "insensitive" } } })) === 1 &&
      same(questionTitles((await db.checklistTemplate.findUniqueOrThrow({ where: { id: sanitaryB.id } })).definition), ["Своё содержание Б?"]),
  );

  // B adds its own sample file to its copy; then A edits the template.
  const withOwnFile = definition(["Чисто?", "Есть мыло?"], ["file:ownfileB0001"]);
  await db.checklistTemplate.update({ where: { id: kitchenB!.id }, data: { definition: withOwnFile } });
  const relinked = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check("AC5: a sample file added in B is not an edit (references are not in the fingerprint)", totals(relinked).updated === 0, totals(relinked));
  await db.checklistTemplate.update({
    where: { id: kitchenA.id },
    data: { definition: definition(["Чисто?", "Есть мыло?", "Перчатки?"], ["file:sample0001abc"]), version: { increment: 1 } },
  });
  await db.checklistTemplate.update({ where: { id: sanitaryA.id }, data: { definition: definition(["Окна вымыты?", "Двери?"]), version: { increment: 1 } } });
  const edited = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  const kitchenB2 = await db.checklistTemplate.findUniqueOrThrow({ where: { id: kitchenB!.id } });
  check("AC5: A's edits are two updates in B", of(edited, b.id)?.checklists.updated === 2, of(edited, b.id)?.checklists);
  check("AC5: B's copy got the new question and its version grew", same(questionTitles(kitchenB2.definition), ["Чисто?", "Есть мыло?", "Перчатки?"]) && kitchenB2.version === kitchenB!.version + 1, kitchenB2);
  check(
    "AC5: B's own sample file stays, A's does not arrive",
    JSON.stringify(kitchenB2.definition).includes("file:ownfileB0001") && !JSON.stringify(kitchenB2.definition).includes("file:sample0001abc"),
  );
  check(
    "AC5: the linked same-title template now follows A's edit",
    same(questionTitles((await db.checklistTemplate.findUniqueOrThrow({ where: { id: sanitaryB.id } })).definition), ["Окна вымыты?", "Двери?"]),
  );
  await db.checklistTemplate.update({ where: { id: sanitaryB.id }, data: { archived: true } });
  const archived = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check(
    "AC5: a template B archived is not created again",
    totals(archived).created === 0 && (await db.checklistTemplate.count({ where: { organizationId: b.id, archived: false, title: { contains: "анитарный", mode: "insensitive" } } })) === 0,
    totals(archived),
  );

  /* ── AC6: другая компания ── */
  console.log("--- AC6: a company of another account");
  const f = await makeOrg("Компания-F");
  const fo = await makeOwner(f.id, "f");
  await db.organization.update({ where: { id: f.id }, data: { disabledJournalCodes: ["cleaning"] } });
  await db.checklistTemplate.create({ data: { organizationId: f.id, title: "Чек-лист компании F", definition: definition(["Своё F?"]) } });
  const request = await createExchangeRequest({ organizationId: f.id, actor: fo.actor, code, mode: "link", kinds: ["journals", "checklists"] });
  const approved = await decideExchangeRequest({
    token: request.token,
    actor: x.actor,
    decision: "approve",
    allowedKinds: ["journals", "checklists"],
    organizationIds: [a.id, b.id],
    waitMs: 120_000,
  });
  check("AC6: F is linked with «Журналы» and «Чек-листы»", approved.status === "approved");
  check(
    "AC6: F got the owner's templates without file references",
    Boolean(await template(f.id, "Проверка кухни")) && !hasReferences((await template(f.id, "Проверка кухни"))?.definition) && Boolean(await template(f.id, "Санитарный день")),
    (await templates(f.id)).map((row) => row.title),
  );
  check("AC6: F's new template reached the owner's organizations", Boolean(await template(a.id, "Чек-лист компании F")) && Boolean(await template(b.id, "Чек-лист компании F")));
  check("AC6: linking does not overwrite F's journal settings", same((await settingsOf(f.id)).disabled, ["cleaning"]), (await settingsOf(f.id)).disabled);

  await db.organization.update({ where: { id: a.id }, data: { disabledJournalCodes: ["health_check", "med_books"] } });
  await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check(
    "AC6: the owner's journal edit reaches F and B",
    same((await settingsOf(f.id)).disabled, ["health_check", "med_books"]) && same((await settingsOf(b.id)).disabled, ["health_check", "med_books"]),
    { f: (await settingsOf(f.id)).disabled, b: (await settingsOf(b.id)).disabled },
  );
  check("AC6: F's switches follow the owner's", same((await peekJournalControls(f.id)).controls.automation, switches), (await peekJournalControls(f.id)).controls.automation);
  await db.organization.update({ where: { id: f.id }, data: { disabledJournalCodes: [] } });
  const fEditTemplate = await template(f.id, "Проверка кухни");
  await db.checklistTemplate.update({ where: { id: fEditTemplate!.id }, data: { definition: definition(["Правка F?"]) } });
  const passive = await runDirectoryExchange(cabinet.id, { actor: x.actor });
  check(
    "AC6: F's own edits (journals, a template of the owner) do not reach the owner",
    same((await settingsOf(a.id)).disabled, ["health_check", "med_books"]) &&
      same(questionTitles((await template(a.id, "Проверка кухни"))!.definition), ["Чисто?", "Есть мыло?", "Перчатки?"]) &&
      totals(passive).updated === 0,
    totals(passive),
  );

  /* ── разовый перенос другой компании ── */
  console.log("--- AC6: a one-off transfer to another company");
  const g = await makeOrg("Компания-G");
  const go = await makeOwner(g.id, "g");
  const gSettingsBefore = await settingsOf(g.id);
  const transferRequest = await createExchangeRequest({ organizationId: g.id, actor: go.actor, code, mode: "transfer", kinds: ["journals", "checklists"] });
  const transferred = await decideExchangeRequest({
    token: transferRequest.token,
    actor: x.actor,
    decision: "approve",
    allowedKinds: ["journals", "checklists"],
    sourceOrganizationId: a.id,
  });
  check("AC6 (transfer): approved", transferred.status === "approved");
  check(
    "AC6 (transfer): G got the owner's templates and journal settings",
    Boolean(await template(g.id, "Проверка кухни")) && same((await settingsOf(g.id)).disabled, ["health_check", "med_books"]),
    { templates: (await templates(g.id)).map((row) => row.title), disabled: (await settingsOf(g.id)).disabled },
  );
  check("AC6 (transfer): a template of another company (F) is not passed to G", !(await template(g.id, "Чек-лист компании F")));
  const gTransfers = await listRecentTransfers({ accountId: go.account.id, userId: go.owner.id });
  check(
    "AC6 (transfer): G's recent transfer marks journals as replaced (undoable since series D, Р10), the rest undoable",
    gTransfers.length === 1 &&
      same(gTransfers[0].fixedKinds, []) &&
      same(gTransfers[0].replacedKinds, ["journals"]) &&
      gTransfers[0].onlyFixed === false &&
      gTransfers[0].undoable &&
      gTransfers[0].counts.checklists === 2,
    gTransfers,
  );
  const gUndo = await undoTransfer({ id: gTransfers[0].id, ownerUserId: go.owner.id, ownerName: go.owner.name });
  check(
    "AC6 (transfer undo): templates deleted, G's previous journal settings restored (series D, Р10)",
    (await db.checklistTemplate.count({ where: { organizationId: g.id } })) === 0 &&
      gUndo.undone.filter((item) => item.entity === "checklist_template").length === 2 &&
      same(gUndo.undone.filter((item) => item.entity === "journal_settings").map((item) => item.action), ["restored"]) &&
      gUndo.kept.length === 0 &&
      same((await settingsOf(g.id)).disabled, gSettingsBefore.disabled),
    gUndo,
  );

  /* ── свой разовый перенос ── */
  console.log("--- own one-off transfer");
  const c = await makeOrg("Третья", x.account.id);
  await join(x.owner.id, c.id);
  const cSettingsBefore = await settingsOf(c.id);
  const preview = await transferPreview({ fromOrganizationId: a.id, toOrganizationId: c.id });
  check(
    "Р8.5 (preview): journals — one settings item, not «exists» while settings differ; checklists — live templates",
    preview.items.journals.length === 1 && preview.items.journals[0].exists === false && preview.items.checklists.map((item) => item.name).sort().join("|") === ["Проверка кухни", "Санитарный день", "Чек-лист компании F"].sort().join("|"),
    { journals: preview.items.journals, checklists: preview.items.checklists.map((item) => item.name) },
  );
  const own = await transferOnce({ fromOrganizationId: a.id, toOrganizationId: c.id, selection: { journals: "all", checklists: "all" }, actor: x.actor });
  check("transfer: summary — journals updated 1, checklists created 3", of(own, c.id)?.journals.updated === 1 && of(own, c.id)?.checklists.created === 3, of(own, c.id));
  check("transfer: C has A's journal settings and switches", same((await settingsOf(c.id)).disabled, ["health_check", "med_books"]) && same((await peekJournalControls(c.id)).controls.automation, switches));
  const again = await transferPreview({ fromOrganizationId: a.id, toOrganizationId: c.id });
  check("transfer: afterwards the preview shows the settings and templates as existing", again.items.journals[0]?.exists === true && again.items.checklists.every((item) => item.exists), again.items.journals);
  // One template gets used (assigned) after the transfer.
  const usedC = await template(c.id, "Санитарный день");
  await db.checklistAssignment.create({
    data: { organizationId: c.id, templateId: usedC!.id, targetKind: "user", targetId: x.owner.id, frequency: "daily", dueTime: "10:00", createdById: x.owner.id, createdByName: "Владелец x" },
  });
  const cTransfers = await listRecentTransfers({ accountId: x.account.id, userId: x.owner.id });
  const cTransfer = cTransfers.find((item) => item.to.id === c.id);
  check(
    "transfer: listed with «Журналы: replaced» (undoable since series D, Р10) and an undo button",
    Boolean(cTransfer) && same(cTransfer!.fixedKinds, []) && same(cTransfer!.replacedKinds, ["journals"]) && cTransfer!.undoable,
    cTransfer,
  );
  const cUndo = await undoTransfer({ id: cTransfer!.id, ownerUserId: x.owner.id, ownerName: x.owner.name });
  check(
    "transfer undo: unused templates deleted, the assigned one kept as «used», previous settings restored (series D, Р10)",
    cUndo.undone.filter((item) => item.entity === "checklist_template").length === 2 &&
      same(cUndo.undone.filter((item) => item.entity === "journal_settings").map((item) => item.action), ["restored"]) &&
      same(cUndo.kept.map((item) => [item.entity, item.reason]), [["checklist_template", "used"]]) &&
      (await db.checklistTemplate.count({ where: { organizationId: c.id } })) === 1 &&
      same((await settingsOf(c.id)).disabled, cSettingsBefore.disabled),
    cUndo,
  );

  const d = await makeOrg("Четвёртая", x.account.id);
  await join(x.owner.id, d.id);
  const dSettingsBefore = await settingsOf(d.id);
  await transferOnce({ fromOrganizationId: a.id, toOrganizationId: d.id, selection: { journals: "all" }, actor: x.actor });
  const dTransfer = (await listRecentTransfers({ accountId: x.account.id, userId: x.owner.id })).find((item) => item.to.id === d.id);
  check(
    "journals-only transfer: undoable since series D (Р10) — replaced, not «only fixed»",
    Boolean(dTransfer) && !dTransfer!.onlyFixed && dTransfer!.undoable && same(dTransfer!.fixedKinds, []) && same(dTransfer!.replacedKinds, ["journals"]),
    dTransfer,
  );
  const dUndo = await undoTransfer({ id: dTransfer!.id, ownerUserId: x.owner.id, ownerName: x.owner.name });
  check(
    "journals-only transfer: undo restores D's previous settings and marks the transfer undone",
    same(dUndo.undone.map((item) => [item.entity, item.action]), [["journal_settings", "restored"]]) &&
      same((await settingsOf(d.id)).disabled, dSettingsBefore.disabled) &&
      (await db.directoryTransfer.findUniqueOrThrow({ where: { id: dTransfer!.id } })).undoneAt !== null,
    dUndo,
  );
  // After the undo D has its own settings again: transferring A's settings replaces them once more…
  const dAgain = await transferOnce({ fromOrganizationId: a.id, toOrganizationId: d.id, selection: { journals: "all" }, actor: x.actor });
  check("after the undo the settings transfer again (a new transfer record)", totals(dAgain).updated === 1 && (await db.directoryTransfer.count({ where: { toOrganizationId: d.id } })) === 2, totals(dAgain));
  // …and the same settings a second time transfer nothing.
  const dSame = await transferOnce({ fromOrganizationId: a.id, toOrganizationId: d.id, selection: { journals: "all" }, actor: x.actor });
  check("same settings again: nothing to transfer, no new transfer record", totals(dSame).updated === 0 && (await db.directoryTransfer.count({ where: { toOrganizationId: d.id } })) === 2, totals(dSame));
}

async function cleanup() {
  const cabinets = await db.organization.findMany({ where: { accountId: { in: accountIds }, kind: "directory" }, select: { id: true } });
  const ids = [...new Set([...cabinets.map((item) => item.id), ...orgIds])].reverse();
  await db.platformSetting.deleteMany({ where: { key: { in: ids.map(controlsKey) } } });
  for (const id of ids) {
    await db.organization.delete({ where: { id } }).catch((error) => {
      if (!String((error as Error).message).includes("not found") && !String((error as Error).message).includes("No record")) console.log(`cleanup: ${id} — ${(error as Error).message.split("\n").pop()}`);
    });
  }
  const left = await db.organization.count({ where: { name: { contains: TAG } } });
  const leftUsers = await db.user.count({ where: { email: { contains: TAG } } });
  const leftAccounts = await db.account.count({ where: { id: { in: accountIds } } });
  const leftLinks = await db.directoryExchangeLink.count({ where: { OR: [{ organizationId: { in: orgIds } }, { masterOrganizationId: { in: orgIds } }] } });
  const leftTemplates = await db.checklistTemplate.count({ where: { organizationId: { in: orgIds } } });
  const leftSettings = await db.platformSetting.count({ where: { key: { in: orgIds.map(controlsKey) } } });
  console.log(`cleanup: organizations left ${left}, users left ${leftUsers}, accounts left ${leftAccounts}, links left ${leftLinks}, templates left ${leftTemplates}, settings left ${leftSettings}`);
}

main()
  .catch((error) => {
    failed += 1;
    console.error("FAIL script crashed", error);
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("cleanup failed", error));
    console.log(`TOTAL: ${passed} PASS, ${failed} FAIL`);
    console.log(failed === 0 ? "RESULT: all checks passed" : `RESULT: ${failed} check(s) failed`);
    await db.$disconnect().catch(() => undefined);
    process.exit(failed === 0 ? 0 : 1);
  });
