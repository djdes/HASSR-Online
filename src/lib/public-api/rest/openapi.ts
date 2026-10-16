import { toolInputJsonSchema, type ApiTool } from "../tools/types";

type JsonSchema = { type?: string; properties?: Record<string, Record<string, unknown>>; required?: string[]; [key: string]: unknown };

const OK_RESPONSE = {
  description: "Успешный ответ",
  content: {
    "application/json": {
      schema: { type: "object", properties: { ok: { const: true }, data: { type: "object" } }, required: ["ok", "data"] },
    },
  },
};

const ERROR_RESPONSE = {
  description: "Ошибка: нет ключа, нет прав, неверные аргументы, лимит запросов",
  content: {
    "application/json": {
      schema: { type: "object", properties: { ok: { const: false }, error: { type: "string" } }, required: ["ok", "error"] },
    },
  },
};

function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

function operationFor(tool: ApiTool) {
  const schema = toolInputJsonSchema(tool) as JsonSchema;
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];
  const inPath = pathParamNames(tool.rest.path);

  const pathParameters = inPath.map((name) => ({
    name,
    in: "path",
    required: true,
    description: properties[name]?.description,
    schema: properties[name] ?? { type: "string" },
  }));

  const operation: Record<string, unknown> = {
    operationId: tool.name,
    summary: tool.title,
    description: tool.description,
    responses: { "200": OK_RESPONSE, "4XX": ERROR_RESPONSE },
  };

  if (tool.rest.method === "GET") {
    const queryParameters = Object.entries(properties)
      .filter(([name]) => !inPath.includes(name))
      .map(([name, prop]) => ({ name, in: "query", required: required.includes(name), description: prop.description, schema: prop }));
    operation.parameters = [...pathParameters, ...queryParameters];
  } else {
    const bodyProperties = Object.fromEntries(Object.entries(properties).filter(([name]) => !inPath.includes(name)));
    const bodyRequired = required.filter((name) => !inPath.includes(name));
    operation.parameters = pathParameters;
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { ...schema, properties: bodyProperties, ...(bodyRequired.length ? { required: bodyRequired } : { required: undefined }) },
        },
      },
    };
  }
  return operation;
}

/** OpenAPI 3.1 из того же реестра, что и MCP: /api/v1/openapi.json. */
export function buildOpenApiDocument(tools: readonly ApiTool[], baseUrl: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const tool of tools) {
    paths[tool.rest.path] ??= {};
    paths[tool.rest.path][tool.rest.method.toLowerCase()] = operationFor(tool);
  }
  return JSON.parse(
    JSON.stringify({
      openapi: "3.1.0",
      info: {
        title: "WeSetup API",
        version: "1.0.0",
        description:
          "Электронные журналы СанПиН и ХАССП: статус журналов, записи документов, заполнение ячеек, сотрудники. Персональный ключ — на странице «ИИ-ассистенты и API» (/settings/api). Те же операции доступны ИИ-ассистентам по MCP: /api/mcp.",
      },
      servers: [{ url: `${baseUrl}/api/v1` }],
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "wsk_…" } } },
      security: [{ bearerAuth: [] }],
      paths,
    })
  );
}
