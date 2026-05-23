---
name: trek-fork-sync
description: Synchronize this TREK fork with its upstream repository and carry fork-specific work forward safely. Use when the user asks to update the fork from the base branch, rebase local work onto the latest upstream changes, merge upstream into the fork's main branch, rebuild a stale feature branch on top of refreshed main, or resolve the recurring TREK fork sync conflicts in app/storage/CI files. If the skill is invoked without explicit user direction about history strategy, default to applying the user's branch on top of the latest upstream changes with the rebase/rebuild workflow.
---

# TREK Fork Sync

## Overview

Update this repository from `upstream`, preserve fork-specific work, and leave the user on the correct branch with a clean git state. Prefer doing the work end to end: inspect remotes and divergence, create safety backups, execute the chosen history strategy, resolve conflicts, and report the exact push command needed.

## Repo assumptions

- Treat this repo as a fork with:
  - `origin` = the user's fork
  - `upstream` = `mauriceboe/TREK`
- Default base branch is `main`.
- Common local integration branch is `chore/updating-from-main`.
- Never destroy user work. Create backup branches before rewriting history.

## Preflight

Run these first:

```bash
git status --short --branch
git remote -v
git branch -vv
git fetch upstream
git rev-list --left-right --count main...upstream/main
```

Also inspect any branch the user wants carried forward:

```bash
git rev-list --left-right --count <branch>...upstream/main
git cherry main <branch>
git log --oneline upstream/main..main
git log --oneline main..<branch>
```

Before any rebase or branch rebuild, create backups:

```bash
git branch backup/main-before-upstream-<date> main
git branch backup/<branch>-before-rewrite-<date> <branch>
```

Use an ISO date like `2026-05-22`.

## Choose the history strategy

Use the user's wording to choose the path:

- If they ask to "apply my changes on top", "rebase from upstream", or "update the repo from the base branch and replay my work", use the rebase/rebuild workflow.
- If they ask to "just merge these changes into main" or want to keep merge history, use the merge workflow.

If the request is ambiguous or the skill is invoked without extra user input, default to the rebase/rebuild workflow. Only choose merge by default when the user explicitly asks to keep merge history or explicitly asks to merge into `main`.

## Rebase and rebuild workflow

Use this when the user wants their fork-specific commits replayed on top of current upstream.

### 1. Rebase `main` onto `upstream/main`

```bash
git rebase upstream/main main
```

If Git requires an editor during `rebase --continue`, run:

```bash
GIT_EDITOR=true git rebase --continue
```

### 2. Resolve the recurring TREK conflicts

The usual conflicts are:

- `server/src/app.ts`
- `server/src/services/tripService.ts`

Resolve them with these rules:

- In `server/src/app.ts`, keep the generic `app.get('/uploads/:type/*', ...)` S3-backed upload serving path. Do not reintroduce the older dedicated `'/uploads/photos/:filename'` route if the generic path already covers it.
- Keep the `/uploads/files` block ahead of the generic upload handler.
- In `server/src/services/tripService.ts`, preserve both:
  - upstream's `shiftOwnerEntriesForTripWindow` behavior
  - fork cleanup via `deleteFile as deleteS3File`
- Keep `deleteOldCover()` deleting from S3 and removing the local fallback file under `uploads/` when present.

### 3. Skip obsolete fork-only version bump commits

If replaying an automated version-bump commit like `chore: bump version to 0.0.1 [skip ci]`, skip it. Keep current upstream version numbers in:

- `charts/trek/Chart.yaml`
- `client/package.json`
- `client/package-lock.json`
- `server/package.json`
- `server/package-lock.json`

### 4. Keep the fork CI change, but not stale versions

If replaying `ci: stop version bump commits in fork`, keep the CI behavior but resolve manifest conflicts to the current upstream version, not an old fork version.

### 5. Rebuild stale branches from refreshed `main`

If a branch like `chore/updating-from-main` is far behind upstream and contains merge noise, rebuild it cleanly:

```bash
git checkout -b rebase/<branch>-<date> main
git cherry main <branch>
```

Replay only `+` commits from `git cherry`. Skip:

- duplicate fixes already present on rebased `main`
- outdated README-only sync commits
- older S3 migration variants that are superseded by `main`

Cherry-pick only the remaining unique work. In this repo that often leaves just the branch-only CI/test hardening commit.

### 6. Resolve the branch-only hardening merge shape

If replaying the server CI/test hardening work, prefer these branch-side resolutions:

- Middleware order:
  - `avatarUpload.single(...)` before `demoUploadBlock`
  - file upload `upload.single(...)` before `demoUploadBlock`
  - cover upload `uploadCover.single(...)` before `demoUploadBlock`
- In `demoUploadBlock`, keep temp-file cleanup for `req.file?.path`.
- Preserve repo-specific messaging that says `TREK`, not `NOMAD`.
- Keep `server/tests/globalSetup.ts` with the S3rver-based setup.
- Keep newer notification and ntfy functionality if already present on the refreshed base; do not drop upstream additions while resolving the hardening commit.

### 7. Move the original branch name to the rebuilt history

After the rebuilt branch is clean:

```bash
git branch -f <branch> rebase/<branch>-<date>
git checkout <branch>
```

Report if the branch now diverges from `origin/<branch>` and give the required `--force-with-lease` push command.

## Merge workflow

Use this when the user wants upstream changes merged into their fork without rewriting history.

### 1. Start from a pre-rewrite main if needed

If `main` was already rebased locally and the user explicitly wants merge history, repoint `main` to the backup branch created before the rebase:

```bash
git branch -f main backup/main-before-upstream-<date>
git checkout main
```

### 2. Merge upstream into `main`

```bash
git merge upstream/main
```

Resolve the same recurring `server/src/app.ts` and `server/src/services/tripService.ts` conflicts with the same rules from the rebase workflow.

Finish with:

```bash
git add <resolved-files>
git commit --no-edit
```

### 3. Merge the user's branch into `main`

```bash
git merge <branch>
```

Typical overlap files:

- `server/src/app.ts`
- `server/src/middleware/auth.ts`
- `server/src/routes/auth.ts`
- `server/src/routes/files.ts`
- `server/src/routes/trips.ts`
- `server/tests/globalSetup.ts`

Resolve those by keeping the branch-side upload-hardening behavior:

- place upload middleware before `demoUploadBlock`
- keep `demoUploadBlock` temp-file cleanup
- keep the branch-side `globalSetup.ts`

Then finish with:

```bash
git add <resolved-files>
git commit --no-edit
```

## Validation

After either workflow, confirm:

```bash
git status --short --branch
git log --oneline --decorate --graph --max-count=10
git rev-list --left-right --count origin/main...main
```

If updating a feature branch too:

```bash
git rev-list --left-right --count <branch>...main
```

Success means:

- working tree is clean
- the intended branch is checked out
- `main` is no longer behind `upstream/main`
- the user's carried-forward branch is based on the refreshed `main`

## Push guidance

Do not push unless the user asks.

Use:

```bash
git push origin main
```

If a rewritten branch must replace the remote:

```bash
git push --force-with-lease origin <branch>
```

If both rebased `main` and a rebuilt branch need publishing:

```bash
git push --force-with-lease origin main <branch>
```

In the final response, state:

- which strategy you used: rebase/rebuild or merge
- which backup branches you created
- which branch is currently checked out
- whether anything still needs to be pushed
