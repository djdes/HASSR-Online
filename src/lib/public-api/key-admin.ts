import { z } from "zod";
import { db } from "@/lib/db";
import { publicBaseUrl } from "./auth";
import { generateApiKey, isApiKeyAccess, MAX_ACTIVE_KEYS_PER_ORG, type ApiKeyAccess } from "./keys";

/** Выпуск, список и отзыв персональных ключей (/settings/api). */

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(60),
  access: z.enum(["write", "read"]).default("write"),
});

export type ApiKeyView = {
  id: string;
  name: string;
  access: ApiKeyAccess;
  displayPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedVia: "mcp" | "rest" | null;
  owner: { id: string; name: string };
  isMine: boolean;
};

const VIEW_SELECT = {
  id: true,
  name: true,
  access: true,
  displayPrefix: true,
  createdAt: true,
  lastUsedAt: true,
  lastUsedVia: true,
  user: { select: { id: true, name: true } },
} as const;

type ViewRow = {
  id: string;
  name: string;
  access: string;
  displayPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  lastUsedVia: string | null;
  user: { id: string; name: string };
};

function toView(row: ViewRow, viewerId: string): ApiKeyView {
  return {
    id: row.id,
    name: row.name,
    access: isApiKeyAccess(row.access) ? row.access : "read",
    displayPrefix: row.displayPrefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    lastUsedVia: row.lastUsedVia === "mcp" || row.lastUsedVia === "rest" ? row.lastUsedVia : null,
    owner: { id: row.user.id, name: row.user.name },
    isMine: row.user.id === viewerId,
  };
}

export async function listOrgApiKeys(orgId: string, viewerId: string): Promise<ApiKeyView[]> {
  const rows = await db.apiAccessKey.findMany({
    where: { organizationId: orgId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: VIEW_SELECT,
  });
  return rows.map((row) => toView(row, viewerId));
}

export async function createApiKey(args: {
  orgId: string;
  user: { id: string; name: string };
  name: string;
  access: ApiKeyAccess;
}): Promise<{ ok: true; key: ApiKeyView; secret: string; mcpUrl: string } | { ok: false; status: 409; error: string }> {
  const active = await db.apiAccessKey.count({ where: { organizationId: args.orgId, revokedAt: null } });
  if (active >= MAX_ACTIVE_KEYS_PER_ORG) {
    return { ok: false, status: 409, error: `В организации уже ${MAX_ACTIVE_KEYS_PER_ORG} ключей — отзовите ненужный` };
  }
  const generated = generateApiKey();
  const row = await db.apiAccessKey.create({
    data: {
      organizationId: args.orgId,
      userId: args.user.id,
      name: args.name,
      access: args.access,
      tokenHash: generated.tokenHash,
      displayPrefix: generated.displayPrefix,
    },
    select: VIEW_SELECT,
  });
  await db.auditLog
    .create({
      data: {
        organizationId: args.orgId,
        userId: args.user.id,
        userName: args.user.name,
        action: "api_key.created",
        entity: "api_key",
        entityId: row.id,
        details: { name: args.name, access: args.access },
      },
    })
    .catch((error) => console.error("[public-api] audit api_key.created failed", error));
  return {
    ok: true,
    key: toView(row, args.user.id),
    secret: generated.secret,
    mcpUrl: `${publicBaseUrl()}/api/mcp/${generated.secret}`,
  };
}

export async function revokeApiKey(args: {
  orgId: string;
  keyId: string;
  actor: { id: string; name: string };
}): Promise<{ ok: true } | { ok: false; status: 404; error: string }> {
  const key = await db.apiAccessKey.findFirst({
    where: { id: args.keyId, organizationId: args.orgId, revokedAt: null },
    select: { id: true, name: true, access: true },
  });
  if (!key) return { ok: false, status: 404, error: "Ключ не найден или уже отозван" };
  await db.apiAccessKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  await db.auditLog
    .create({
      data: {
        organizationId: args.orgId,
        userId: args.actor.id,
        userName: args.actor.name,
        action: "api_key.revoked",
        entity: "api_key",
        entityId: key.id,
        details: { name: key.name, access: key.access },
      },
    })
    .catch((error) => console.error("[public-api] audit api_key.revoked failed", error));
  return { ok: true };
}
