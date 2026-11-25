import * as React from "react";
import { renderToString } from "react-dom/server";
import { App, content, makeChunk } from "./app.jsx";
export const html = renderToString(React.createElement(App, { chunk: makeChunk(content(), true) }));
export const version = React.version;
