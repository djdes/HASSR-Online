// SSR той же версией React, что в выбранной сборке Next (NEXT_DIR/dist/compiled/react*).
import { createRequire } from "node:module";
const { build } = createRequire(import.meta.url)("/home/user/HASSR-Online/node_modules/esbuild");
import fs from "node:fs";
const NEXT = process.env.NEXT_DIR;
const require = createRequire(import.meta.url);
const out = new URL("./out/", import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const alias = {
  react: `${NEXT}/dist/compiled/react`,
  "react-dom/client": `${NEXT}/dist/compiled/react-dom/client.js`,
  "react-dom/server": `${NEXT}/dist/compiled/react-dom/server.node.js`,
  "next/dist/compiled/react": `${NEXT}/dist/compiled/react`,
  "next/dist/compiled/react-dom": `${NEXT}/dist/compiled/react-dom`,
  "next/dist/compiled/scheduler": `${NEXT}/dist/compiled/scheduler`,
};
await build({ entryPoints: [new URL("./ssr-entry.jsx", import.meta.url).pathname], bundle: true, platform: "node", format: "cjs", outfile: `${out}ssr.cjs`, alias, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
await build({ entryPoints: [new URL("./client-entry.jsx", import.meta.url).pathname], bundle: true, platform: "browser", format: "iife", outfile: `${out}client.js`, alias, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
const { html, version } = require(`${out}ssr.cjs`);
fs.writeFileSync(`${out}index.html`, `<!doctype html><html><body><div id="root">${html}</div><script src="client.js"></script></body></html>`);
console.log("react", version, "ssr:", html);
