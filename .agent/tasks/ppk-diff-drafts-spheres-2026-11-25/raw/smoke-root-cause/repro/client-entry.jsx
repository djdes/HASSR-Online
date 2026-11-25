import * as React from "react";
import { hydrateRoot } from "react-dom/client";
import { App, content, makeChunk } from "./app.jsx";
const chunk = makeChunk(content(), false);
window.__errors = [];
const origError = console.error;
console.error = (...args) => { window.__errors.push(args.map(String).join(" ")); origError(...args); };
// Как Next (app-index.js): гидратация внутри startTransition — конкурентный рендер с повтором приостановленной работы.
React.startTransition(() => {
  hydrateRoot(document.getElementById("root"), React.createElement(App, { chunk }), {
    onRecoverableError: (error) => window.__errors.push("recoverable: " + String(error && error.message)),
  });
});
setTimeout(() => { window.__done = true; }, 400);
