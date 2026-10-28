---
name: trek-fork-sync
description: Synchronize this TREK fork with its upstream repository and carry fork-specific work forward safely. Use when the user asks to update the fork from the base branch, rebase local work onto the latest upstream changes, merge upstream into the fork's main branch, rebuild a stale feature branch on top of refreshed main, or resolve the recurring TREK fork sync conflicts in the NestJS upload controllers, S3 storage services, CI workflow, or Railway deploy files. If the skill is invoked without explicit user direction about history strategy, default to applying the user's branch on top of the latest upstream changes with the rebase/rebuild workflow.
---

# TREK fork sync

Synchronize this fork with upstream, preserve its deployment and storage behavior, and finish on the intended branch with a clean working tree. Default to rebase/rebuild unless the user explicitly asks for merge history. Do not push unless asked.

## Repository and history

- `origin` is `jaksiri/TREK-railway`; `upstream` is `mauriceboe/TREK`, which GitHub redirects to the current upstream repository. Inspect remotes before fetching.
- Base branch is `main`. This is an npm-workspaces monorepo with one root `package-lock.json`; do not introduce per-workspace lockfiles or change package managers as part of the sync.
- Create dated backup branches before rewriting. Preserve dirty work and leave branches checked out in other worktrees alone unless the user includes them in the request.
- Fetch upstream, inspect divergence and fork-only commits, then replay unique work. Keep manifest versions at the current upstream version.

```bash
git status --short --branch
git remote -v
git branch -vv
git worktree list
git fetch upstream
git rev-list --left-right --count main...upstream/main
git log --oneline upstream/main..main
git branch backup/main-before-upstream-<date> main
```

Use an ISO date and a suffix if the backup name already exists. For an included feature branch, also back it up and inspect `git cherry main <branch>` and `git log main..<branch>`.

## Storage (current as of the v5.0 sync)

Upstream now implements S3 and local storage through NestJS `StorageService`, `StorageRegistryService`, and drivers under `server/src/nest/storage/`. The old fork's controller hooks and legacy service imports are superseded. Do not resurrect deleted services or add a second upload call beside `storage.put`.

Preserve these fork-specific additions:

- `server/src/app-config/boot-derive.ts`: `deriveLegacyS3` reads `AWS_ENDPOINT_URL`, `AWS_S3_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optional `AWS_DEFAULT_REGION`. All four required values enable S3; incomplete configuration keeps local storage. Region defaults to `us-east-1`. Since 5.0 every env var has one owner, so it lives in `deriveStorage` (the `storageConfig` token), not in `derive.ts`/`readEnv()`. `deriveStorage` has an explicit return type with `legacyS3` optional, so upstream's test stubs (`{ placePhotoDir: undefined }`) keep compiling without edits.
- `server/src/app-config/env.schema.ts`: lists the five `AWS_*` variables (`env-reference.test.ts` and `config-ownership.test.ts` fail without them). `server/src/app-config/env.ts`: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are in `SECRET_ENV_KEYS` (`validate.test.ts` fails without them).
- `server/src/nest/storage/storage-registry.service.ts`: defines the `fork-s3` backend from `this.storageEnv.legacyS3` in `mergeBackendsAndCategories`. Defaults `files`, `journey`, `covers`, `avatars`, and legacy `photos` to it, using unchanged `<category>/<filename>` keys. Explicit backend/category settings take precedence. Backups and new upstream cache categories retain upstream defaults.
- `server/src/nest/storage/drivers/legacy-s3.driver.ts`: now exports `LegacyS3Driver`, extending upstream's S3 driver. Writes go to S3. Reads/stat fall back to existing local files, while S3 wins over stale local copies. Deletes attempt S3 then local cleanup. Listing includes local-only objects without duplicating remote keys so backups and migrations see them.
- `server/src/nest/storage/storage-admin.service.ts`: `storedBackendsRow` (async, reads `appSettings.getValue`) resolves masked environment credentials during the first admin save, then encrypts them using upstream secret handling. Stored settings take precedence, so a saved `fork-s3` row with an old secret overrides newer env credentials.
- `server/.env.example`: documents the AWS compatibility variables.
- Regression coverage: `server/tests/unit/nest/storage/legacy-s3.test.ts` and the AWS compatibility cases in `storage-registry.service.test.ts`.

The native driver uses upstream's `@aws-lite/client` and `@aws-lite/s3` dependencies. The older `@aws-sdk/*` dependencies, `persistUploadToS3`, and `getFileStream` exports are no longer required. Preserve behavior through the current abstraction, not obsolete symbols.

Verify upstream keeps storage calls for avatars, trip/collection/Unsplash covers, trip files, collab attachments, and journey originals/thumbnails/posters/covers. Relevant modules are `auth`, `trips`, `collections`, `unsplash`, `files`, `collab`, `journey`, and `memories` under `server/src/nest/`.

Serving also uses upstream's storage abstraction now:

- `StorageService.sendToResponse` handles Range/206, HEAD, conditional requests, streaming cleanup, and root-relative local `sendFile`.
- `platform.routes.ts` uses storage-backed mounts for avatars, covers, journey, and places. Photos retain their authorization gate; direct `/uploads/files` stays blocked.
- The old generic `/uploads/:type/*path` route and exact four-type allowlist are superseded. Do not replace upstream's authenticated routes or drop the new `places` category to recreate that old route.
- Authenticated file downloads tolerate legacy `files/`-prefixed filenames using `path.basename`.
- Shared journey serving and lazy thumbnail generation must continue through `StorageService`, so remote media and video seeking work.

## Railway deployment

Keep `Dockerfile.railway`, `docker-entrypoint.sh`, and `railway.toml`.

`Dockerfile.railway` mirrors the current upstream Dockerfile, including Node version, workspace build stages, native dependencies, runtime assets, and upstream entrypoint. Its additions copy the Railway entrypoint, create `/app/storage`, and run the Railway script between dumb-init and the upstream entrypoint.

`docker-entrypoint.sh` maps data/uploads into the single Railway volume at `/app/storage`, creates upload category directories including journey and places, repairs ownership on the actual volume data/uploads directories, and then executes upstream's entrypoint. Recursive chown on the `/app/data` symlink alone does not make the existing encryption key readable by `node`. Upstream owns startup checks and dropping privileges to `node`. `railway.toml` selects the Railway Dockerfile and `/api/health`.

When upstream changes its Dockerfile, regenerate the Railway copy from it rather than patching the old one: copy `Dockerfile`, then replace its single `ENTRYPOINT ["dumb-init", "--"]` line with the Railway `COPY docker-entrypoint.sh`, `chmod`/`mkdir -p /app/storage` and `ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/railway-entrypoint"]` lines. `diff Dockerfile Dockerfile.railway` must show only that hunk. Keeping an old image layout while updating the app can silently omit runtime assets or break native SQLite. The v5.0 sync found the old copy still copying the removed `client/scripts/patch-maplibre.mjs` and building the server without upstream's 4 GB heap flag.

Railway config is moving from `railway.toml` (read until 2026-12-01) to `.railway/railway.ts`. That file is a named partial (`export const partial = "TREK-railway"`) because the same Railway project holds `money-mcp` from another repo, and a whole-project apply deletes resources the file omits. It declares the service (Dockerfile builder with `Dockerfile.railway`, `/api/health`, restart policy), the `/app/storage` volume and the `integrated-duffel` bucket, with variables unmanaged. The SDK is installed in `.railway/package.json` only, outside the npm workspaces. `railway config plan` is read-only; `apply` and `railway config migrate cutover` change the live service. Keep both files consistent until cutover, then delete `railway.toml`.

## CI and other fork behavior

Since 5.0 upstream gates the release job with `if: github.repository == 'liketrek/TREK'`, so `docker.yml` does not run on the fork at all. Still keep the fork's diff minimal on conflict: take upstream's new steps (`Release from main only`, the `ci-ok` verdict check) and drop only the release-app token and the bump/commit/push block.

Preserve `.github/workflows/docker.yml`'s no-bump behavior:

- Capture `SHA=$(git rev-parse HEAD)` in the version job.
- Downstream checkout uses `needs.version-bump.outputs.sha`.
- Tag only after the image build succeeds.
- Do not reintroduce `npm version`, a bump commit, or `git push origin main --follow-tags`.

Keep the non-Google-ID guard in `server/src/nest/maps/maps.helpers.ts`: colon-delimited IDs must not call Google Places. Preserve upstream's additional coordinate/photo-index checks. Leaflet self-hosting is already upstream; do not reintroduce the old CDN stylesheet.

## Execute the selected strategy

For a straightforward replay:

```bash
git rebase upstream/main main
# Resolve conflicts by combining current upstream behavior with the fork additions.
GIT_EDITOR=true git rebase --continue
```

When major upstream refactoring supersedes most old patches, abort a conflicted replay and rebuild on a temporary branch from upstream instead. Cherry-pick still-relevant commits and port the remaining behavior into current modules. Compare against the backup so no unique work disappears. Commit the port, validate, then move `main` to the rebuilt history and check it out.

For included stale feature branches, create a backup, rebuild from refreshed `main`, and replay only remaining unique work. Skip duplicate fixes and superseded migration/version-sync commits. Move the original branch name only after validation.

If the user explicitly requests merge history, merge upstream into `main` instead, resolve with the same behavior-preservation rules, then merge any included feature branch. Do not switch strategies solely to avoid resolving overlaps.

## Validation and completion

Check the working tree, ancestry, and divergence:

```bash
git status --short --branch
git merge-base --is-ancestor upstream/main main
git rev-list --left-right --count origin/main...main
git log --oneline --decorate --graph --max-count=10
git ls-files server/src/nest/storage/drivers/legacy-s3.driver.ts Dockerfile.railway docker-entrypoint.sh railway.toml
git diff --check
sh -n docker-entrypoint.sh
```

Run server `typecheck` and `typecheck:tests` (the latter needs `NODE_OPTIONS=--max-old-space-size=8192` or tsc runs out of memory), the ratchets `lint:warnings`, `lint:format`, `lint:strict` and `lint:boundaries` (a new `!` or an unformatted fork file fails them), and the `tests/unit/app-config`, `tests/unit/nest/storage` and maps tests, then `test:unit`. Run Prettier on every fork file you touched. Known non-fork failures on macOS: `PREMIG-008` (`/var` vs `/private/var` path) and, at v5.0.0, `INS-012` (a plugin fixture pinned to TREK `<5.0.0`).

`npm install` after the rebase rewrites `peer` flags in `package-lock.json`; that churn is local npm noise, not part of the sync, so do not commit it. Use a Node runtime compatible with installed native modules. Shared package artifacts must match the new source; if builds are restricted, use temporary test/typecheck aliases to `shared/src`, including the distinct `@trek/shared/roadtrip` entry at `shared/src/roadtrip/planning.ts`. Remove temporary validation configuration and generated alternate lockfiles before finishing. Do not claim a Docker build or live S3 test passed unless it actually ran.

Report the strategy, backup branch names, current branch, validation result, and pending push. A rewritten remote main needs:

```bash
git push --force-with-lease origin main
```

Railway deploys `main` from GitHub on push, so a pushed sync is a production deploy; a major upstream version migrates the database on first boot (TREK writes `pre-migrate-*.db` next to it first). Changed Railway variables, including rotated bucket credentials, apply only on a new deployment: use Redeploy, not Restart. A stale secret shows up as `SignatureDoesNotMatch` (403) on every `fork-s3` call and 500s on `/uploads/*`.

For an ordinary merge, use `git push origin main`. If an included feature branch was also rewritten, include that branch in the force-with-lease push guidance. Do not push automatically.
