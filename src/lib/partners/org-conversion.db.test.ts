import assert from "node:assert/strict";
import test from "node:test";

/**
 * Перевод и возврат на живой базе — с настоящими `accrueForPaidOrder`,
 * транзакцией и каскадами. В обычном `npm test` пропускается: нужна
 * локальная база рабочей копии (`wesetup_wt_*` или `wesetup_e2e`) и явный
 * флаг — чтобы тест никогда не писал в чужую или боевую базу.
 *
 *   WESETUP_DB_TESTS=1 DATABASE_URL=postgresql://…/wesetup_wt_orgsw \
 *     node --import tsx --test src/lib/partners/org-conversion.db.test.ts
 */
const DB_URL = process.env.DATABASE_URL ?? "";
const LOCAL_DB = /@(localhost|127\.0\.0\.1)(:\d+)?\/(wesetup_wt_[a-z0-9_]+|wesetup_e2e)(\?|$)/.test(DB_URL);
const enabled = process.env.WESETUP_DB_TESTS === "1" && LOCAL_DB;
const SKIP = enabled ? false : "нужна локальная база: WESETUP_DB_TESTS=1 и DATABASE_URL на wesetup_wt_*";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

test("перевод и возврат на живой базе: аккаунт, тариф, срок, привязка, начисления", { skip: SKIP }, async (t) => {
  const { db } = await import("@/lib/db");
  const { convertOrganizationToPartnerClient, returnClientToOwnAccount, loadConversionPreview } = await import(
    "./org-conversion"
  );
  const { accrueForPaidOrder } = await import("./accruals");
  const { getCurrentRewardRule } = await import("./schema-extras");
  const { percentOf } = await import("./rewards");

  const run = `dbt${Date.now().toString(36)}`;
  const paidUntil = new Date(Date.now() + 40 * DAY);
  const created = { orgs: [] as string[], users: [] as string[], partners: [] as string[], orders: [] as number[] };

  async function org(name: string, extra: Record<string, unknown> = {}) {
    const row = await db.organization.create({
      data: { name: `${name} ${run}`, type: "cafe", subscriptionPlan: "free", ...extra },
      select: { id: true },
    });
    created.orgs.push(row.id);
    return row.id;
  }

  async function paidOrder(organizationId: string, paidAt: Date, amountRub = 1990) {
    const row = await db.paymentOrder.create({
      data: {
        email: `${run}@example.com`,
        tariffKey: "monthly",
        amountRub,
        description: "Подписка (тест перевода)",
        status: "paid",
        organizationId,
        paidAt,
        createdAt: new Date(paidAt.getTime() - MIN),
      },
      select: { id: true },
    });
    created.orders.push(row.id);
    return row.id;
  }

  try {
    // --- Посев: партнёр-консультант со своей компанией и двумя кафе в личном аккаунте.
    const home = await org("Консалтинг");
    const cafe = await org("Кафе", { inn: "7709999991" });
    const bar = await org("Бар");
    const owner = await db.user.create({
      data: {
        email: `${run}-owner@example.com`,
        name: "Олег Партнёров",
        passwordHash: "x",
        role: "owner",
        organizationId: home,
        journalAccessMigrated: true,
      },
      select: { id: true },
    });
    created.users.push(owner.id);
    const account = await db.account.create({
      data: { ownerUserId: owner.id, subscriptionPlan: "paid", subscriptionEnd: paidUntil },
      select: { id: true },
    });
    await db.organization.updateMany({ where: { id: { in: [home, cafe, bar] } }, data: { accountId: account.id } });
    await db.organizationMember.createMany({
      data: [home, cafe, bar].map((organizationId) => ({ userId: owner.id, organizationId, role: "owner" })),
    });
    // Автопродление кафе — с карты владельца.
    await db.organization.update({ where: { id: cafe }, data: { recurringActive: true, recurringParentOrderId: 1 } });
    // Повар кафе — занимает место.
    const cook = await db.user.create({
      data: { email: `${run}-cook@example.com`, name: "Повар", passwordHash: "", role: "cook", organizationId: cafe },
      select: { id: true },
    });
    created.users.push(cook.id);
    const partner = await db.partner.create({
      data: {
        slug: run,
        code: run.slice(-6).toUpperCase().padStart(6, "Q"),
        status: "active",
        type: "consultant",
        companyName: `Консалт ${run}`,
        inn: "7701234560",
        city: "Москва",
        phone: "+70000000000",
        contactEmail: `${run}-partner@example.com`,
        termsAcceptedAt: new Date(),
        applicantUserId: owner.id,
        applicantOrganizationId: home,
      },
      select: { id: true },
    });
    created.partners.push(partner.id);
    await db.partnerUser.create({ data: { partnerId: partner.id, userId: owner.id, role: "owner" } });

    // Оплата кафе ДО перевода (час назад) — вознаграждения по ней быть не должно.
    const beforeOrder = await paidOrder(cafe, new Date(Date.now() - 60 * MIN));

    await t.test("предпросмотр виден владельцу, своя компания заявителя — отказ", async () => {
      const preview = await loadConversionPreview({ userId: owner.id, organizationId: cafe, inForeignMode: false });
      assert.ok(preview);
      assert.equal(preview.plan.ok, true);
      const own = await loadConversionPreview({ userId: owner.id, organizationId: home, inForeignMode: false });
      assert.ok(own);
      assert.equal(own.plan.ok, false);
      if (!own.plan.ok) assert.ok(own.plan.blockers.some((b) => b.code === "applicant_organization"));
    });

    await t.test("перевод кафе: аккаунт, тариф, срок, автопродление, членство, привязка", async () => {
      const result = await convertOrganizationToPartnerClient({
        userId: owner.id,
        userEmail: `${run}-owner@example.com`,
        actorName: "Олег Партнёров",
        organizationId: cafe,
        inForeignMode: false,
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      const after = await db.organization.findUniqueOrThrow({
        where: { id: cafe },
        select: { accountId: true, subscriptionPlan: true, subscriptionEnd: true, recurringActive: true },
      });
      assert.equal(after.accountId, null);
      assert.equal(after.subscriptionPlan, "paid");
      assert.equal(after.subscriptionEnd?.getTime(), paidUntil.getTime());
      assert.equal(after.recurringActive, false);
      const acc = await db.account.findUniqueOrThrow({ where: { id: account.id }, select: { subscriptionEnd: true } });
      assert.equal(acc.subscriptionEnd?.getTime(), paidUntil.getTime(), "личный аккаунт сохраняет свою оплату");
      const member = await db.organizationMember.findUnique({
        where: { userId_organizationId: { userId: owner.id, organizationId: cafe } },
      });
      assert.equal(member, null, "владелец больше не член — доступ через партнёрский кабинет");
      const link = await db.partnerClient.findFirstOrThrow({ where: { organizationId: cafe, detachedAt: null } });
      assert.equal(link.partnerId, partner.id);
      assert.equal(link.source, "converted");
      assert.equal(link.accessLevel, "edit");
      assert.equal(link.convertedByUserId, owner.id);
      const consent = await db.paymentConsent.findFirst({ where: { organizationId: cafe, granted: false } });
      assert.ok(consent, "отзыв согласия на автосписания записан");
      const audit = await db.auditLog.findFirst({ where: { organizationId: cafe, action: "partner.org_converted" } });
      assert.ok(audit, "аудит в организации");
      const auditHome = await db.auditLog.findFirst({ where: { organizationId: home, action: "partner.org_converted" } });
      assert.ok(auditHome, "аудит в домашней организации владельца");
    });

    await t.test("повторный перевод — отказ «уже клиент»", async () => {
      const again = await convertOrganizationToPartnerClient({
        userId: owner.id,
        userEmail: `${run}-owner@example.com`,
        actorName: "Олег Партнёров",
        organizationId: cafe,
        inForeignMode: false,
      });
      assert.equal(again.ok, false);
    });

    const rule = await getCurrentRewardRule();

    await t.test("оплата до перевода вознаграждения не даёт", async () => {
      const accrual = await accrueForPaidOrder(beforeOrder);
      assert.equal(accrual.created, 0);
    });

    await t.test("оплаты после перевода дают начисления по действующим правилам", async () => {
      const first = await paidOrder(cafe, new Date(Date.now() + 1000));
      const a1 = await accrueForPaidOrder(first);
      assert.deepEqual(
        a1.drafts.map((d) => [d.kind, d.amountRub]),
        [["subscription", percentOf(1990, rule.subscriptionPercent)]],
      );
      const rows = await db.partnerAccrual.findMany({ where: { paymentOrderId: first } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].partnerId, partner.id);
      const second = await paidOrder(cafe, new Date(Date.now() + 2000));
      const a2 = await accrueForPaidOrder(second);
      const kinds = a2.drafts.map((d) => d.kind);
      assert.ok(kinds.includes("subscription"));
      if (rule.bonusAmountRub > 0 && rule.bonusAfterPayments === 2) assert.ok(kinds.includes("bonus"));
    });

    await t.test("вернуть оплаченную клиентом организацию нельзя", async () => {
      const back = await returnClientToOwnAccount({
        partnerId: partner.id,
        brandName: "Консалт",
        userId: owner.id,
        actorName: "Олег Партнёров",
        organizationId: cafe,
      });
      assert.equal(back.ok, false);
      if (!back.ok) assert.ok(back.blockers.some((b) => b.code === "paid_after_conversion"));
    });

    await t.test("бар: перевод → возврат → оплата не даёт начисления", async () => {
      const converted = await convertOrganizationToPartnerClient({
        userId: owner.id,
        userEmail: `${run}-owner@example.com`,
        actorName: "Олег Партнёров",
        organizationId: bar,
        inForeignMode: false,
      });
      assert.equal(converted.ok, true, JSON.stringify(converted));
      const back = await returnClientToOwnAccount({
        partnerId: partner.id,
        brandName: "Консалт",
        userId: owner.id,
        actorName: "Олег Партнёров",
        organizationId: bar,
      });
      assert.equal(back.ok, true, JSON.stringify(back));
      const row = await db.organization.findUniqueOrThrow({ where: { id: bar }, select: { accountId: true } });
      assert.equal(row.accountId, account.id, "бар снова в личном аккаунте");
      const member = await db.organizationMember.findUnique({
        where: { userId_organizationId: { userId: owner.id, organizationId: bar } },
      });
      assert.equal(member?.role, "owner");
      const link = await db.partnerClient.findFirstOrThrow({ where: { organizationId: bar }, orderBy: { attachedAt: "desc" } });
      assert.ok(link.detachedAt);
      assert.equal(link.detachedBy, "partner");
      const audit = await db.auditLog.findFirst({ where: { organizationId: bar, action: "partner.org_returned" } });
      assert.ok(audit);
      const order = await paidOrder(bar, new Date(Date.now() + 5000));
      const accrual = await accrueForPaidOrder(order);
      assert.equal(accrual.created, 0, "после возврата комиссия не начисляется");
    });

    await t.test("передача клиенту переносит тариф и срок, возврат отменяет неподтверждённое приглашение", async () => {
      const { assignClientOwner } = await import("./client-organizations");
      const bakery = await org("Пекарня");
      await db.organization.update({ where: { id: bakery }, data: { accountId: account.id } });
      await db.organizationMember.create({ data: { userId: owner.id, organizationId: bakery, role: "owner" } });
      const converted = await convertOrganizationToPartnerClient({
        userId: owner.id,
        userEmail: `${run}-owner@example.com`,
        actorName: "Олег Партнёров",
        organizationId: bakery,
        inForeignMode: false,
      });
      assert.equal(converted.ok, true, JSON.stringify(converted));

      const inviteEmail = `${run}-boss@example.com`;
      const handover = await assignClientOwner({
        partnerId: partner.id,
        organizationId: bakery,
        actorUserId: owner.id,
        actorName: "Олег Партнёров",
        brandName: "Консалт",
        organizationName: "Пекарня",
        owner: { email: inviteEmail, name: "Директор Пекарни" },
      });
      assert.equal(handover.status, "invited");
      const placeholder = await db.user.findUniqueOrThrow({
        where: { email: inviteEmail },
        select: { id: true, ownedAccount: { select: { id: true, subscriptionPlan: true, subscriptionEnd: true } } },
      });
      created.users.push(placeholder.id);
      assert.equal(placeholder.ownedAccount?.subscriptionPlan, "paid", "аккаунт будущего владельца — с тарифом организации");
      assert.equal(placeholder.ownedAccount?.subscriptionEnd?.getTime(), paidUntil.getTime(), "и с её оплаченным сроком");

      const back = await returnClientToOwnAccount({
        partnerId: partner.id,
        brandName: "Консалт",
        userId: owner.id,
        actorName: "Олег Партнёров",
        organizationId: bakery,
      });
      assert.equal(back.ok, true, JSON.stringify(back));
      if (back.ok) assert.equal(back.inviteRevoked, true);
      assert.equal(await db.user.findUnique({ where: { email: inviteEmail } }), null, "заглушка приглашения удалена");
      assert.equal(await db.account.findUnique({ where: { id: placeholder.ownedAccount!.id } }), null, "и её пустой аккаунт");
      const row = await db.organization.findUniqueOrThrow({ where: { id: bakery }, select: { accountId: true } });
      assert.equal(row.accountId, account.id);
    });
  } finally {
    // Уборка: заказы, партнёр (каскад — привязки, начисления), люди (каскад —
    // аккаунт), организации (каскад — всё остальное).
    await db.partnerAccrual.deleteMany({ where: { paymentOrderId: { in: created.orders } } }).catch(() => undefined);
    await db.paymentOrder.deleteMany({ where: { id: { in: created.orders } } }).catch(() => undefined);
    await db.paymentConsent.deleteMany({ where: { organizationId: { in: created.orgs } } }).catch(() => undefined);
    await db.partner.deleteMany({ where: { id: { in: created.partners } } }).catch(() => undefined);
    await db.user.deleteMany({ where: { id: { in: created.users } } }).catch(() => undefined);
    await db.organization.deleteMany({ where: { id: { in: created.orgs } } }).catch(() => undefined);
  }
});
