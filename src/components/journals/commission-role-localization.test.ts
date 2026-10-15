/* eslint-disable react/no-children-prop -- Explicit children for isolated SSR event fixtures. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/i18n/messages";
import { commissionRoleLabel, defaultCommissionRole, normalizeCommissionMembers, type BrakerageCommissionMember } from "@/lib/brakerage-commission";

const require = createRequire(import.meta.url);
type Props = Record<string, unknown>;
type Draft = { employeeId: string; name: string; role: string; roleKind?: "chair" | "member" };

/** Real production handlers/JSX; only initial hook state and DOM portals are isolated. */
function fixture(initial: unknown[], fetcher?: typeof fetch) {
  let cursor = 0;
  const states = [...initial];
  const nodes: { type: unknown; props: Props }[] = [];
  const wrapped = (fn: typeof jsxRuntime.jsx) => (type: unknown, props: Props, key?: string) => {
    nodes.push({ type, props });
    return fn(type as React.ElementType, props, key);
  };
  const fragment = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  const output = ts.transpileModule(readFileSync("src/components/journals/commission-dialog.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const fixtureModule = { exports: {} as { CommissionDialog: React.ElementType } };
  vm.runInNewContext(output, {
    module: fixtureModule, exports: fixtureModule.exports, fetch: fetcher, crypto: globalThis.crypto,
    require: (id: string) => {
      if (id === "react") return { ...React, useState: (fallback: unknown) => {
        const index = cursor++;
        if (index >= states.length) states[index] = typeof fallback === "function" ? fallback() : fallback;
        return [states[index], (value: unknown) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      } };
      if (id === "react/jsx-runtime") return { ...jsxRuntime, jsx: wrapped(jsxRuntime.jsx), jsxs: wrapped(jsxRuntime.jsxs) };
      if (id === "@/components/ui/dialog") return new Proxy({}, { get: () => fragment });
      if (id === "sonner") return { toast: { success() {}, error(message: string) { throw new Error(message); } } };
      return require(id);
    },
  });
  return { Component: fixtureModule.exports.CommissionDialog, states, nodes };
}

async function render(locale: "ru" | "en" | "uz", view: ReturnType<typeof fixture>, onSaved?: (members: BrakerageCommissionMember[]) => void) {
  return renderToStaticMarkup(React.createElement(NextIntlClientProvider, {
    locale, messages: await loadMessages(locale), timeZone: "Europe/Moscow", onError: error => { throw error; },
    children: React.createElement(view.Component, { code: "finished_product", open: true, onClose() {}, onSaved }),
  }));
}

function handler(view: ReturnType<typeof fixture>, name: string, match: (props: Props) => boolean) {
  const node = view.nodes.find(node => match(node.props) && typeof node.props[name] === "function");
  assert.ok(node, `Missing production ${name} handler`);
  return node.props[name] as (event?: unknown) => void;
}

test("commission real add/edit/save/reopen handlers localize only generated roles in RU/EN/UZ", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const copy = (await loadMessages(locale)).journalControls.commissionDialog;
    const candidates = [{ id: "u1", name: "O‘tkir", position: "Custom position", group: "staff", hasPin: true }, { id: "u2", name: "Second", position: "", group: "staff", hasPin: true }];
    let view = fixture([[], candidates, true, false, false, true, "", null, null]);
    await render(locale, view);
    handler(view, "onClick", props => String(props.onClick).includes("addMember(candidate)"))();
    assert.equal((view.states[0] as Draft[])[0].role, "Председатель");
    assert.equal((view.states[0] as Draft[])[0].roleKind, "chair");
    view = fixture([...view.states.slice(0, 5), true, "", null, null]);
    await render(locale, view);
    assert.ok(view.nodes.some(node => node.type === "input" && node.props.value === copy.chair));
    handler(view, "onClick", props => String(props.onClick).includes("addMember(candidate)"))();
    assert.equal((view.states[0] as Draft[])[1].roleKind, "member");

    let saved: BrakerageCommissionMember[] = [];
    let requestBody: { members: Draft[] } | undefined;
    const savedSignal = Promise.withResolvers<void>();
    view = fixture(view.states, async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      saved = normalizeCommissionMembers(requestBody!.members.map(member => ({ ...member, employeeName: candidates.find(candidate => candidate.id === member.employeeId)!.name })));
      return Response.json({ members: saved, updatedDocuments: 1 });
    });
    await render(locale, view, () => savedSignal.resolve());
    handler(view, "onClick", props => String(props.onClick).includes("void save()"))();
    await savedSignal.promise;
    assert.deepEqual(requestBody!.members.map(member => [member.role, member.roleKind]), [["Председатель", "chair"], ["Член комиссии", "member"]]);
    const reopened = saved.map(member => ({ ...member, name: member.employeeName }));
    view = fixture([reopened, candidates, true, false, false, false, "", null, null]);
    await render(locale, view);
    for (const expected of [copy.chair, copy.member]) assert.ok(view.nodes.some(node => node.type === "input" && node.props.value === expected));
    handler(view, "onChange", props => props.value === copy.chair)({ target: { value: "Председатель" } });
    assert.equal((view.states[0] as Draft[])[0].roleKind, undefined, "actual editing clears provenance even for identical canonical wording");
    const edited = normalizeCommissionMembers((view.states[0] as Draft[]).map(member => ({ ...member, employeeName: member.name })));
    assert.equal(edited[0].roleKind, undefined);
    view = fixture([edited.map(member => ({ ...member, name: member.employeeName })), candidates, true, false, false, false, "", null, null]);
    await render(locale, view);
    assert.ok(view.nodes.some(node => node.type === "input" && node.props.value === "Председатель"));
  }
});

test("new-person role defaults and edited default-looking custom strings retain provenance correctly", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const copy = (await loadMessages(locale)).journalControls.commissionDialog;
    for (const memberCount of [0, 1]) {
      const members = memberCount ? [{ employeeId: "u1", name: "First", ...defaultCommissionRole("chair") }] : [];
      let view = fixture([members, [], true, false, false, false, "", null, null]);
      await render(locale, view);
      handler(view, "onClick", props => String(props.onClick).includes('fullName: ""'))();
      const kind = memberCount ? "member" : "chair";
      assert.equal((view.states[7] as Draft).roleKind, kind);
      view = fixture(view.states);
      await render(locale, view);
      const roleInput = view.nodes.find(node => node.type === "input" && node.props.placeholder === copy.role)!;
      assert.equal(roleInput.props.value, copy[kind]);
      (roleInput.props.onChange as (event: unknown) => void)({ target: { value: "Член комиссии" } });
      assert.equal((view.states[7] as Draft).roleKind, undefined);
      assert.equal((view.states[7] as Draft).role, "Член комиссии");
    }
  }
});

test("normalization preserves explicit custom roles, validates tags and tags only missing source roles", async () => {
  const input = [{ id: "a", employeeName: "A", role: "Председатель" }, { id: "b", employeeName: "B", role: "Член комиссии" }, { id: "c", employeeName: "C" }, { id: "d", employeeName: "D", ...defaultCommissionRole("chair") }, { id: "e", employeeName: "E", role: "Custom", roleKind: "chair" }, { id: "f", employeeName: "F", role: "Председатель", roleKind: "invalid" }];
  const before = JSON.stringify(input);
  const normalized = normalizeCommissionMembers(input);
  assert.deepEqual(normalized.map(member => member.roleKind), [undefined, undefined, "member", "chair", undefined, undefined]);
  assert.deepEqual(normalizeCommissionMembers(JSON.parse(JSON.stringify(normalized))), normalized);
  for (const locale of ["ru", "en", "uz"] as const) {
    const labels = (await loadMessages(locale)).journalControls.commissionDialog;
    assert.deepEqual(normalized.map(member => commissionRoleLabel(member, labels)), ["Председатель", "Член комиссии", labels.member, labels.chair, "Custom", "Председатель"]);
  }
  assert.equal(JSON.stringify(input), before);
});

test("new-person actual submit sends canonical generated roles and original edited roles, never display translations", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    for (const custom of [false, true]) {
      const person = { fullName: "O‘tkir", phone: "", pin: "739251", ...(custom ? { role: "Председатель" } : defaultCommissionRole("chair")) };
      let payload: Record<string, unknown> | undefined;
      const savedSignal = Promise.withResolvers<void>();
      const view = fixture([[], [], true, false, false, false, "", person, null], async (_url, init) => {
        payload = JSON.parse(String(init?.body));
        return Response.json({ user: { id: "new", name: "O‘tkir" }, pin: person.pin, members: normalizeCommissionMembers([{ ...payload, employeeId: "new", employeeName: "O‘tkir" }]) });
      });
      await render(locale, view, () => savedSignal.resolve());
      handler(view, "onClick", props => String(props.onClick).includes("void createPerson()"))();
      await savedSignal.promise;
      assert.equal(payload!.role, "Председатель");
      assert.equal(payload!.roleKind, custom ? undefined : "chair");
      assert.equal((view.states[0] as Draft[])[0].roleKind, custom ? undefined : "chair");
    }
  }
});
