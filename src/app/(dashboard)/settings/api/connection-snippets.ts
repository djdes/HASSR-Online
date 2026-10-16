/** Тексты для копирования на странице «ИИ-ассистенты и API». */

export type ConnectionSnippets = {
  claudeUrl: string;
  chatgptUrl: string;
  claudeCode: string;
  cursorJson: string;
  curl: string;
};

export function buildConnectionSnippets(args: {
  baseUrl: string;
  secret: string | null;
  placeholder: string;
}): ConnectionSnippets {
  const base = args.baseUrl.replace(/\/+$/, "");
  const key = args.secret ?? args.placeholder;
  const secretLink = `${base}/api/mcp/${key}`;
  return {
    claudeUrl: secretLink,
    chatgptUrl: secretLink,
    claudeCode: `claude mcp add --transport http wesetup ${base}/api/mcp --header "Authorization: Bearer ${key}"`,
    cursorJson: JSON.stringify(
      { mcpServers: { wesetup: { url: `${base}/api/mcp`, headers: { Authorization: `Bearer ${key}` } } } },
      null,
      2
    ),
    curl: `curl ${base}/api/v1/journals -H "Authorization: Bearer ${key}"`,
  };
}
