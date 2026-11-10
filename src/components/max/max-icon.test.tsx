import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MaxIcon } from "./max-icon";
import { renderMaxQrAction } from "@/lib/max/qr";

test("MaxIcon renders official MAX gradient and speech-bubble path with unique gradient IDs", () => {
  const html = renderToStaticMarkup(
    <div>
      <MaxIcon className="size-14" />
      <MaxIcon className="size-7" />
    </div>,
  );

  assert.match(html, /viewBox="0 0 1000 1000"/);
  assert.match(html, /stop-color="#4cf"/);
  assert.match(html, /stop-color="#53e"/);
  assert.match(html, /stop-color="#93d"/);
  assert.match(html, /M508\.211 878\.328/);

  const ids = [...html.matchAll(/id="(max-(?:lin|rad)-[^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4, "each MaxIcon instance uses unique gradient IDs");
});

test("renderMaxQrAction uses the official MAX SVG icon", () => {
  const html = renderMaxQrAction();
  assert.match(html, /viewBox="0 0 1000 1000"/);
  assert.match(html, /M508\.211 878\.328/);
});

test("/max/connect page uses BrandLogo instead of legacy plain text WeSetup logo", () => {
  const pageSource = readFileSync("src/app/max/connect/page.tsx", "utf8");
  assert.match(pageSource, /BrandLogo/);
  assert.doesNotMatch(pageSource, /We<span/);
});

test("Sonner toaster uses SiteTheme and enforces readable description contrast in light and dark modes", () => {
  const sonnerSource = readFileSync("src/components/ui/sonner.tsx", "utf8");
  const globalsCss = readFileSync("src/app/globals.css", "utf8");

  assert.match(sonnerSource, /useSiteTheme/);
  assert.doesNotMatch(sonnerSource, /next-themes/);
  assert.match(
    globalsCss,
    /\[data-sonner-toaster\]\[data-sonner-theme="light"\] \[data-sonner-toast\]\[data-styled="true"\] \[data-description\]/,
  );
  assert.match(
    globalsCss,
    /\[data-sonner-toaster\]\[data-sonner-theme="dark"\] \[data-sonner-toast\]\[data-styled="true"\] \[data-description\]/,
  );
});
