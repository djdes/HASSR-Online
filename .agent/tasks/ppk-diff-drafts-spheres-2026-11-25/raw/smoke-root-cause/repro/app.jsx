// Минимальное воспроизведение ошибки React (исправлена в facebook/react#35518):
// при гидратации «ленивый» ребёнок (как строка RSC, ещё не дошедшая до браузера) приостанавливает
// Fragment, стоящий вторым в списке детей (так Next в dev оборачивает сегмент в SegmentViewNode).
// Повтор работы после приостановки снимал с Fragment флаг Forked → id из useId ниже менялись.
import * as React from "react";

export function makeChunk(value, resolved) {
  const listeners = [];
  const chunk = {
    status: resolved ? "fulfilled" : "pending",
    value: resolved ? value : undefined,
    then(onFulfilled) {
      if (chunk.status === "fulfilled") onFulfilled(chunk.value);
      else listeners.push(onFulfilled);
    },
    resolve() {
      chunk.status = "fulfilled";
      chunk.value = value;
      for (const listener of listeners.splice(0)) listener(value);
    },
  };
  return chunk;
}

function lazyOf(chunk) {
  return {
    $$typeof: Symbol.for("react.lazy"),
    _payload: chunk,
    _init(payload) {
      if (payload.status === "fulfilled") return payload.value;
      // Как строка Flight, у которой данные уже есть, но разбор завершится в микрозадаче.
      if (!payload.scheduled) {
        payload.scheduled = true;
        queueMicrotask(() => payload.resolve());
      }
      throw payload;
    },
  };
}

function Labelled() {
  const id = React.useId();
  React.useEffect(() => { if (typeof window !== "undefined") window.__clientId = id; }, [id]);
  return React.createElement("button", { id, "aria-controls": id + "content" }, "switcher");
}

function SegmentViewNode({ children }) {
  // Как next/dist/next-devtools/userspace/app/segment-explorer-node.js: [узел дерева сегментов, children].
  return React.createElement(React.Fragment, null, React.createElement("i", { key: "trie" }), children);
}

export function App({ chunk }) {
  return React.createElement(
    "main",
    null,
    React.createElement(
      SegmentViewNode,
      null,
      React.createElement(React.Fragment, { key: "segment" }, React.createElement("link", { key: "assets", rel: "x" }), lazyOf(chunk)),
    ),
  );
}

export const content = () => React.createElement("section", null, React.createElement(Labelled));
