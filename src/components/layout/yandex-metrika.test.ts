import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { YandexMetrika } from "./yandex-metrika";

function emittedBootstrap(): string {
  const previous = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
  process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "12345678";
  try {
    const element = YandexMetrika() as unknown as {
      props: { children: Array<{ props: { dangerouslySetInnerHTML: { __html: string } } }> };
    };
    return element.props.children[0].props.dangerouslySetInnerHTML.__html;
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    else process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = previous;
  }
}

function runBootstrap(pathname: string, userAgent = "Browser"): number {
  let inserted = 0;
  const context: Record<string, unknown> = {
    navigator: { userAgent },
    location: { pathname, href: "https://wesetup.test" + pathname },
    document: {
      scripts: [], referrer: "",
      createElement: () => ({}),
      getElementsByTagName: () => [{ parentNode: { insertBefore: () => { inserted++; } } }],
    },
  };
  context.window = context;
  vm.runInNewContext(emittedBootstrap(), context);
  return inserted;
}

test("emitted Metrika bootstrap parses and keeps MAX and QR routes private", () => {
  new vm.Script(emittedBootstrap());
  for (const route of ["/max", "/max/connect", "/max/journals", "/settings/integrations/max", "/settings/integrations/max/group", "/journal-fill/org/hygiene", "/equipment-fill/org/id", "/room-fill/org/id", "/task-fill/token"]) {
    assert.equal(runBootstrap(route), 0, route);
  }
});

test("emitted Metrika bootstrap retains normal site analytics and the native app guard", () => {
  for (const route of ["/", "/journals", "/more", "/max-other", "/settings/integrations/tasksflow"]) {
    assert.equal(runBootstrap(route), 1, route);
    assert.equal(runBootstrap(route, "WeSetupApp/1.0 (android)"), 0, route);
  }
});
