import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { relativeRedirect, safeInternalPath } from "@/lib/relative-redirect";

describe("safeInternalPath", () => {
  it("пропускает обычный путь с параметрами", () => {
    assert.equal(
      safeInternalPath("/login?next=/settings/consultant"),
      "/login?next=/settings/consultant"
    );
  });

  it("режет протокол-относительный адрес — это уход на чужой домен", () => {
    assert.equal(safeInternalPath("//evil.com/phish"), "/");
    assert.equal(safeInternalPath("/\\evil.com"), "/");
  });

  it("режет абсолютные адреса и мусор", () => {
    for (const bad of ["https://evil.com", "http://evil.com", "evil.com", "", "   "]) {
      assert.equal(safeInternalPath(bad), "/");
    }
  });
});

describe("relativeRedirect", () => {
  it("отдаёт 307 и относительный Location", () => {
    const res = relativeRedirect("/register");
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), "/register");
  });

  it("умеет 308 для постоянного переезда", () => {
    assert.equal(relativeRedirect("/order", 308).status, 308);
  });

  it("не отдаёт абсолютный адрес даже если его попросили", () => {
    assert.equal(
      relativeRedirect("https://localhost:3002/register").headers.get("location"),
      "/"
    );
  });

  it("на ответе можно ставить cookie — партнёрская метка едет с редиректом", () => {
    const res = relativeRedirect("/register");
    res.cookies.set({ name: "wesetup.partner", value: "abc", path: "/" });
    assert.match(res.headers.get("set-cookie") ?? "", /wesetup\.partner=abc/);
  });
});

/**
 * `NextResponse.redirect` / `Response.redirect` always send an absolute
 * `Location`. In a route handler the only absolute base at hand is
 * `request.url`, and in production that is `https://localhost:3002`:
 * «Панель платформы» led there (2026-11-09). Redirect with
 * `relativeRedirect`; an absolute redirect needs the public origin from
 * `NEXTAUTH_URL` and an entry below.
 */
const ABSOLUTE_REDIRECT_ALLOWED: Record<string, string> = {
  "src/app/api/kiosk/claim/[token]/route.ts": "origin from NEXTAUTH_URL (resolveQrPosterOrigin)",
  "src/app/download/android/route.ts": "fixed external address of the APK file (ANDROID_APK_URL), not built from the request",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Code only: comments may quote the bad pattern (see relative-redirect.ts). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

describe("redirects from route handlers and server code", () => {
  it("never send an absolute Location built from the request", () => {
    const files = [...sourceFiles("src/app"), ...sourceFiles("src/lib")].map((file) => file.split("\\").join("/"));
    assert.ok(files.length > 500, "the walk found the sources");
    const offenders = files.filter(
      (file) => !(file in ABSOLUTE_REDIRECT_ALLOWED) && /\b(?:NextResponse|Response)\.redirect\(/.test(stripComments(readFileSync(file, "utf8"))),
    );
    assert.deepEqual(offenders, [], "use relativeRedirect(path) from @/lib/relative-redirect");
  });
});
