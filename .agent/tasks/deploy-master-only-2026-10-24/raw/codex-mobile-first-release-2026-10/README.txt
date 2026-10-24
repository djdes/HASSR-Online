branch: codex/mobile-first-release-2026-10
tip:    6c9bae94381f618adf2b065877687ed7f3c7a858
base:   ff81de23300e07efdfe1774d5ef1fedcb31afb90  (master 2026-10-01, ff81de23)
deleted: 2026-10-24 по просьбе владельца репозитория

Восстановить ветку:
  git switch -c codex/mobile-first-release-2026-10 ff81de23300e07efdfe1774d5ef1fedcb31afb90
  git am .agent/tasks/deploy-master-only-2026-10-24/raw/codex-mobile-first-release-2026-10/*.patch

6c9bae94 2026-10-08 00:30:03 +0300 Preserve Unix newlines in the Xcode Firebase copy phase
ee39589b 2026-10-08 00:24:58 +0300 Add and verify iOS required-reason privacy manifest for file export
3edf4333 2026-10-08 00:11:41 +0300 Complete first-publication handoff and preserve iOS simulator artifact permissions
18e915c0 2026-10-08 00:00:05 +0300 Prepare first mobile release: validate signing and separate builds from uploads
