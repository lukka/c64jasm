# Copilot Instructions

## Branch Roles

Three distinct branches are involved; do not confuse them:

- `main` (local, fork): primary branch of the `lukka/c64jasm` fork. Contains the
  full VS Code extension plus the c64jasm core.
- `nurpax-master` (local): a read-only MIRROR of the upstream `nurpax/c64jasm`
  `master` branch. Never the target of a PR; used only as the base to branch
  from and to diff against.
- `nurpax-contrib` (local): the branch you push to your fork and open the PR
  FROM. Based on `nurpax-master`, core-only.

### PR Target

The pull request flow is:

```
nurpax-contrib (local PR branch)
      │  push to your fork, then open PR
      ▼
nurpax/c64jasm  ->  master  (the real, remote upstream PR target)
```

The PR is always opened FROM `nurpax-contrib` TO the `master` branch of the
remote `nurpax/c64jasm` repository. The local `nurpax-master` mirror is never a
PR target.

## Commit Rules

- Keep commit scope single-domain.
- VS Code extension changes must be in extension-only commits.
- c64jasm assembler/core changes must be in core-only commits.
- Never mix extension and core assembler changes in the same commit.

## Contribution Intent

- Any core changes that may be proposed upstream must be isolated in commits based on `nurpax-master`.

## Core Commit Synchronization (main <-> nurpax-contrib)

Every c64jasm core/assembler commit must exist on BOTH branches:

- `main`: the fork's primary branch (full extension + core).
- `nurpax-contrib`: the upstream-facing PR branch (core-only, based on
  `nurpax-master`).

To keep them from drifting, follow these rules:

- Single source of truth: author each core commit on `nurpax-contrib` FIRST,
  then copy it to `main` with `git cherry-pick -x <sha>`. The `-x` flag records
  the original commit hash in the message so the two copies remain traceable.
- Core commits must be core-only (`src/**`, `test/**`, and, when genuinely
  relevant upstream, `package.json`, `tsconfig*.json`, `docs/**`, `examples/**`)
  so the exact same patch applies cleanly to both branches.
- Never author a core change directly on `main` and leave it off
  `nurpax-contrib`; if it happens, cherry-pick it onto `nurpax-contrib`.

### Handling divergence from upstream review

`nurpax-contrib` may receive ADDITIONAL commits that change the code (for
example, fixups requested during upstream PR review). When that happens:

- Do NOT amend or rewrite the already-published commit on `nurpax-contrib`;
  add the review changes as NEW follow-up commits on `nurpax-contrib`.
- Immediately propagate each such follow-up commit back to `main` with
  `git cherry-pick -x <sha>` so the two branches stay equivalent.
- Treat the flow as one-directional: core changes and their review fixups
  originate on `nurpax-contrib` and are mirrored onto `main`, never the reverse.
- Before opening or updating the PR, the squashed/intended upstream diff
  (`git diff nurpax-master..nurpax-contrib`) and the corresponding core diff on
  `main` must be identical.

## Never Contribute Upstream

The `nurpax/c64jasm` upstream repository ships the c64jasm npm package, whose
contents are limited to `dist/**`, `src/**`, and `test/**` (see the `files`
field in `package.json`).

In addition to everything under `vscode/`, the following paths outside
`vscode/` are unrelated to the c64jasm npm package and must NEVER be included in
commits intended for the upstream PR (`nurpax-contrib`, targeting
`nurpax/c64jasm` `master`):

- `.github/` — this fork's Copilot instructions and fork-specific automation.
  EXCEPTION: the core c64jasm build/test CI workflow
  (`.github/workflows/build-c64jasm.yml`, which modernizes upstream's existing
  `nodejs.yml`) DOES belong upstream, because it builds and tests the core
  package itself. Workflows that are fork-only — the VSIX build
  (`build-vsix.yml`), the Marketplace release (`release.yml`), and
  `copilot-instructions.md` — must NEVER go upstream.
- `.vscode/` — local editor settings.
- `temp_test/` — local scratch/experiment area.
- `build/` — local build output.
- `dist/` — generated build artifacts.
- `node_modules/` — installed dependencies.
- `c64jasm-*.tgz` — locally packed npm tarballs.
- `yarn.lock` — this fork uses it locally; upstream tracks `package-lock.json`.
- `.DS_Store` — macOS metadata.

When backporting, restrict the patch to core package files only (`src/**`,
`test/**`, and, when genuinely relevant upstream, `package.json`, `tsconfig*.json`,
`docs/**`, `examples/**`, and the core CI workflow
`.github/workflows/build-c64jasm.yml`).
