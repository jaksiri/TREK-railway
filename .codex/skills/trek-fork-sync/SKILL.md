---
name: trek-fork-sync
description: Synchronize this TREK fork with its upstream repository and carry fork-specific work forward safely. Use when the user asks to update the fork from the base branch, rebase local work onto the latest upstream changes, merge upstream into the fork's main branch, rebuild a stale feature branch on top of refreshed main, or resolve the recurring TREK fork sync conflicts in the NestJS upload controllers, S3 storage services, CI workflow, or Railway deploy files. If the skill is invoked without explicit user direction about history strategy, default to applying the user's branch on top of the latest upstream changes with the rebase/rebuild workflow.
---

# TREK Fork Sync

## Overview

Update this repository from `upstream`, preserve fork-specific work, and leave the user on the correct branch with a clean git state. Prefer doing the work end to end: inspect remotes and divergence, create safety backups, execute the chosen history strategy, resolve conflicts, and report the exact push command needed.

## Repo assumptions

- Treat this repo as a fork with:
  - `origin` = the user's fork (`jaksiri/TREK-railway`)
  - `upstream` = `mauriceboe/TREK`
- Default base branch is `main`.
- The backend is **NestJS** (`server/src/nest/**`), not the old Express `server/src/app.ts`. Any guidance mentioning `app.ts`, `demoUploadBlock`, or Express route files is obsolete.
- This is an **npm-workspaces monorepo** with a single root `package-lock.json`. There are no per-workspace lockfiles (`client/package-lock.json` / `server/package-lock.json` do not exist).
- Never destroy user work. Create backup branches before rewriting history.

## What this fork carries over upstream

Every sync must preserve these three groups of fork-specific work. Knowing them turns most conflicts into "keep both sides": upstream's logic plus the fork's hook next to it.

### 1. S3-backed uploads (with local-disk fallback)

All upload types — avatars, covers, trip files, collab note files, and journey media (gallery/entry photos, videos, posters, covers) — are stored in S3 when configured, and fall back to local disk when S3 env vars are unset (self-host without object storage). Journey was the last type still pinned to disk; as of `feat: migrate journey media to S3` nothing is local-only anymore.

- New file, never conflicts — ensure it survives every sync: `server/src/services/s3.ts`. Exports `isS3Configured`, `persistUploadToS3(file, subdir)`, `getFileStream(key, range?)`, `deleteFile(key)` (imported elsewhere as `deleteS3File`), plus `uploadFile/uploadStream/uploadBuffer/listFiles` and `tempDir`. `getFileStream` takes an optional HTTP `Range` and returns `{ stream, contentType, contentLength, contentRange, acceptRanges, statusCode }` — S3 answers a satisfiable range with `206` + `Content-Range` (video seeking); no-range callers still get `200`.
- **Upload path** — each handler became `async` and calls `persistUploadToS3(file, subdir)` before the DB write; on failure it unlinks the local temp and throws a 500. Subdirs: `avatars`, `covers`, `files`, `journey`.
  - `server/src/nest/auth/auth.controller.ts` — avatars
  - `server/src/nest/trips/trips.controller.ts` — covers (upload handler + the Unsplash-cover download, which persists to S3 non-fatally)
  - `server/src/nest/collections/collections.controller.ts` — covers
  - `server/src/nest/collab/collab.controller.ts` — note files (`files`)
  - `server/src/nest/files/files.controller.ts` — trip files (`files`)
  - `server/src/nest/journey/journey.controller.ts` — journey originals, eagerly-generated thumbnails, gallery-video posters, and covers (`journey`). Covers are stored with a `journey/<filename>` URL and served by the generic route below.
- **Serve path** — stream from S3 via `getFileStream(key, range?)`, falling back to a local file with `res.sendFile(path.basename(x), { root: path.dirname(x) })` (the `{ root }` form is required under the Nest ExpressAdapter). Thread the request `Range` through for journey videos so seeking returns `206`.
  - `server/src/nest/files/files-download.controller.ts` — authenticated download; key is `files/<filename>`.
  - `server/src/services/memories/photoResolverService.ts` — `stream()` serves journey originals/thumbnails from S3 with local fallback, threading `Range` for 206 video responses, and lazily regenerates a missing thumbnail by pulling the original from S3 when it isn't on disk.
  - `server/src/nest/journey/journey-public.controller.ts` / `server/src/nest/journey/journey.service.ts` — thread `Range` into the public share-photo proxy so shared journey videos honour seeking.
  - `server/src/nest/platform/platform.routes.ts` (`applyPlatformUploads`) — a generic `app.get('/uploads/:type/*path', ...)` handler serves `avatars`, `covers`, `journey`, and `photos` from S3 with local fallback. **The route uses the Express 5 named wildcard `*path` (read via `req.params.path`), not `*`/`req.params[0]`.** **The `type` allowlist must be `['avatars', 'covers', 'journey', 'photos']`** — a `type` not on the list returns 404 before any serving, so a dropped entry silently breaks that whole upload type. Keep the `/uploads/files` 401 block AHEAD of the generic handler so it isn't shadowed. There is no longer a `/uploads/journey` `express.static` line — journey is served by the generic handler. Photos keep their auth gate (session JWT with pv, or a share token scoped to the photo's trip); avatars/covers/journey are unauthenticated by design.
- **Delete path** — import `deleteFile as deleteS3File` from `../services/s3`, delete from S3 first (fire-and-forget / awaited best-effort), then remove any local fallback file.
  - `server/src/services/fileService.ts` — `permanentDeleteFile`, `emptyTrash`
  - `server/src/services/authService.ts` — `saveAvatar`, `deleteAvatar`
  - `server/src/services/collabService.ts` — `deleteNote`, `deleteNoteFile`
  - `server/src/services/collectionsService.ts` — `deleteOldCollectionCover`
  - `server/src/services/tripService.ts` — `deleteOldCover`
- **S3 key convention** — for trip files the stored `filename` may already include the `files/` prefix, so guard: `const key = file.filename.startsWith('files/') ? file.filename : \`files/${file.filename}\``. Covers/avatars use `covers/<basename>` and `avatars/<filename>`.
- **Dependencies / config** (`server/package.json`): `@aws-sdk/client-s3` and `@aws-sdk/lib-storage` in `dependencies`, `s3rver` in `devDependencies`. Env vars in `server/.env.example`: `AWS_ENDPOINT_URL`, `AWS_S3_BUCKET_NAME`, `AWS_DEFAULT_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

### 2. Railway deploy layer

New files, they do not conflict — just confirm they survive the sync:

- `Dockerfile.railway` — npm-workspaces monorepo build mirroring the upstream Dockerfile, with the Railway volume entrypoint swapped into the run stage.
- `docker-entrypoint.sh` — symlinks `/app/data` and `/app/uploads` into the single Railway volume at `/app/storage`.
- `railway.toml` — points the build at `Dockerfile.railway`; healthcheck `/api/health`.

### 3. Fork CI change

`.github/workflows/docker.yml` — the fork removed the in-CI version-bump commit (upstream runs `npm version --workspaces ...`, commits `chore: bump version to X [skip ci]`, and pushes to `main`). The fork instead captures the build SHA, builds from that SHA, and pushes only a git tag after the build succeeds. This file conflicts on nearly every sync — re-apply the fork's no-bump behavior (see resolution rules below).

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

Use an ISO date like `2026-07-09`.

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

### 2. Resolve the recurring conflicts

The files that conflict are the ones the fork touches AND upstream actively develops:

- The five upload controllers under `server/src/nest/` (auth, trips, collections, collab, files) and `server/src/nest/files/files-download.controller.ts`
- `server/src/nest/platform/platform.routes.ts`
- The touched services: `fileService.ts`, `authService.ts`, `collabService.ts`, `collectionsService.ts`, `tripService.ts`
- `.github/workflows/docker.yml`
- `server/package.json`, root `package-lock.json`, `server/.env.example`

General rule: the fork's changes are **additive** — an S3 import plus a push/serve/delete hook alongside the existing local-disk logic. Resolve by keeping **both** upstream's new logic and the fork's S3 hook. Concretely:

- Keep the `import ... from '../../services/s3'` (or `../services/s3`) line the fork added.
- In upload handlers, keep the method `async` and keep the `persistUploadToS3(file, subdir)` block (with its local-temp cleanup + 500 on failure) before the DB write.
- In `platform.routes.ts`, keep the generic `app.get('/uploads/:type/*path', ...)` S3-backed handler and keep the `/uploads/files` 401 block AHEAD of it. Do not reintroduce the old dedicated `'/uploads/photos/:filename'` route or the `/uploads/journey` `express.static` line. This handler is a high-risk merge point: it has been touched by both an Express 5 wildcard fix (`*path` / `req.params.path`) and the journey-S3 change (adding `journey` to the allowlist), so a careless resolution drops one. After resolving, verify the route reads `req.params.path` AND the allowlist is exactly `['avatars', 'covers', 'journey', 'photos']`.
- In services, keep the `deleteS3File(...)` call before the local `fs.rm`/`unlinkSync` fallback.
- Preserve any upstream additions to these files (new routes, new behavior); do not drop them while re-applying the S3 hooks.

### 3. Re-apply the fork CI change

When `.github/workflows/docker.yml` conflicts, keep the fork's behavior, not upstream's:

- Do NOT reintroduce the `npm version "$NEW_VERSION" --workspaces ...`, the `chore: bump version ... [skip ci]` commit, or the `git push origin main --follow-tags` in the `version-bump` job.
- Keep the fork's `SHA=$(git rev-parse HEAD) >> $GITHUB_OUTPUT` output and the downstream jobs checking out `ref: ${{ needs.version-bump.outputs.sha }}` instead of `ref: main`.
- Keep the "Push git tag" step that tags `v$VERSION` after the build.

### 4. Keep manifests at the current upstream version

Resolve `server/package.json` and root `package-lock.json` to the current upstream version numbers (plus the fork's added S3 dependencies). Never carry an old fork version number forward. The fork no longer produces `chore: bump version` commits, so you should not see fork-only version-bump commits to skip; if an old one appears in the replay, drop it.

### 5. Rebuild stale branches from refreshed `main`

If a branch like `chore/updating-from-main` (or `feat/journey-s3`) is far behind upstream and carries merge noise, rebuild it cleanly:

```bash
git checkout -b rebase/<branch>-<date> main
git cherry main <branch>
```

Replay only `+` commits from `git cherry`. Skip:

- duplicate fixes already present on rebased `main`
- older S3-migration variants superseded by `main`
- README-only or version-bump sync commits

Cherry-pick only the remaining unique work, resolving any upload-path conflicts with the same "keep both, keep the S3 hook" rule above.

### 6. Move the original branch name to the rebuilt history

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

Resolve the recurring conflicts with the same rules as the rebase workflow (keep both upstream logic and the fork's S3 hooks; re-apply the fork CI change; keep manifests at the upstream version). Typical overlap files:

- `server/src/nest/{auth,trips,collections,collab,files}/*.controller.ts`
- `server/src/nest/files/files-download.controller.ts`
- `server/src/nest/platform/platform.routes.ts`
- `server/src/services/{fileService,authService,collabService,collectionsService,tripService}.ts`
- `.github/workflows/docker.yml`
- `server/package.json`, root `package-lock.json`, `server/.env.example`

Finish with:

```bash
git add <resolved-files>
git commit --no-edit
```

### 3. Merge the user's branch into `main`

```bash
git merge <branch>
```

Resolve overlaps by keeping the branch-side upload behavior, then finish with:

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

Then sanity-check the fork work survived:

```bash
git ls-files server/src/services/s3.ts Dockerfile.railway docker-entrypoint.sh railway.toml
grep -rl "persistUploadToS3\|getFileStream\|deleteS3File" server/src/nest server/src/services | sort
# Uploads route must keep the Express 5 wildcard AND the full type allowlist:
grep -n "uploads/:type/\*path\|'avatars', 'covers', 'journey', 'photos'" server/src/nest/platform/platform.routes.ts
```

Success means:

- working tree is clean
- the intended branch is checked out
- `main` is no longer behind `upstream/main`
- `server/src/services/s3.ts`, the Railway files, and the S3 hooks in the controllers/services are all still present
- `.github/workflows/docker.yml` still has the fork's no-bump behavior
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
