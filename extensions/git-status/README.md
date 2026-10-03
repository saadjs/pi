# @saadjs/pi-git-status

Git status in Pi's footer, alongside other extensions' statuses.

```text
main • 3 changed • 2 untracked • +42 −17
```

Clean trees show `main • clean`. The status is hidden outside Git repositories or when Git is unavailable.

## Install

```bash
pi install npm:@saadjs/pi-git-status
```

To try locally from the monorepo root:

```bash
pi -e ./extensions/git-status/index.ts
```

Use an absolute path to `index.ts` when running Pi in another repository.

## Counts

- **Branch:** current branch, or `detached`.
- **Changed:** tracked files with staged or unstaged changes, counted once per file, including renames, conflicts, and submodule changes.
- **Untracked:** individual untracked files; ignored files are excluded.
- **+ / −:** net tracked-file line additions/deletions against `HEAD`. Untracked and binary contents are excluded.

Counts cover the whole repository, even from a subdirectory. Refreshes on session start, after successful `edit`/`write` tools, and after agent completion.

Custom footers must display extension statuses via `footerData.getExtensionStatuses()`.

## Test

```bash
pnpm --filter @saadjs/pi-git-status test
```
