import { z } from "zod";
import { orgTodayKey } from "@/lib/timezone";
import { toolOk, type ApiTool } from "./types";

export const getContextTool: ApiTool = {
  name: "get_context",
  title: "Кто я и где",
  description:
    "Кто я и где: организация, сегодняшняя дата в её часовом поясе, права ключа. Вызови в начале разговора.",
  access: "read",
  input: z.object({}),
  rest: { method: "GET", path: "/me" },
  async handler(_input, ctx) {
    return toolOk({
      organization: { id: ctx.orgId, name: ctx.orgName, timezone: ctx.timezone },
      today: orgTodayKey(ctx.timezone ?? undefined),
      user: { id: ctx.actor.id, name: ctx.actor.name, role: ctx.actor.role },
      key: { name: ctx.keyName, access: ctx.access },
      appUrl: `${ctx.baseUrl}/dashboard`,
    });
  },
};
