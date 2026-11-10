# Step 4 (#195): nodemailer 7.0.13 → 10.3.1 — REJECTED (not shipped)

## What passed
- Changelog 8.0 / 9.0 / 10.0 checked: `NoAuth` → `ENOAUTH` (no code checks it), TLS validation for remote
  attachment URLs (attachments here are local paths or in-memory content), Node ≥ 20 (server: 22),
  rewrite in TypeScript with ESM + CJS builds and an `exports` map (no `nodemailer/lib/*` imports in code).
- `npm run typecheck` clean with the bundled types.
- Same e-mails sent through a local SMTP catcher with STARTTLS (self-signed, like exim on prod) and AUTH:
  verification code (`sendVerificationEmail`), e-mail with Reply-To, text+HTML and two attachments with
  Cyrillic names (`sendRawEmail`), own-mailbox style transport with AUTH, stream transport (mailing dry-run).
  v7 vs v10: same envelopes, STARTTLS used, AUTH accepted, headers identical except Message-ID/Date/boundary,
  same MIME tree, same attachment names, identical decoded payloads, same transfer encodings.

## Why it is not shipped
`npm ci` (what deploy step 1/3 runs on the server) fails:

```
npm error ERESOLVE could not resolve
npm error While resolving: next-auth@4.24.15
npm error Found: nodemailer@10.3.1
npm error Could not resolve dependency:
npm error peerOptional nodemailer@"^7.0.7" from next-auth@4.24.15
```

next-auth 4.24.15 is the latest 4.x and pins the optional peer `nodemailer ^7.0.7`; only next-auth 5
(beta) lifts it. `npm install` locally succeeded, so only a clean `npm ci` shows the break — on the server
this would have stopped the deploy at step 1 after node_modules removal.
Forcing it (`--legacy-peer-deps`, `overrides`) is not worth it for this update.

## Outcome
- nodemailer stays at 7.0.13 (latest 7.x).
- `.github/dependabot.yml`: ignore nodemailer / @types/nodemailer major updates, with the reason;
  `src/lib/deploy-build-memory.test.ts` checks the rule.
- Dependabot #195 closed.
