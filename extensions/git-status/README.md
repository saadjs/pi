# @saadjs/pi-git-status

Git status in Pi's footer, alongside other extensions' statuses.

```text
feat • #3 • 3 changed • 2 untracked • +42 −17
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

## Pull request

`#3` is the GitHub PR for the current branch, found with `gh pr view`. It's a clickable link (OSC 8) in terminals that support them. Colors: green for open, muted for draft, accent for merged, red for closed. It's hidden on `main`/`master`, when there is no PR, and when `gh` is missing or signed out.

The PR is looked up when the session starts, when the branch changes, and after `git push`, `git checkout`, `git switch`, or `gh pr` commands. Between those, it's polled every 90s while you're active. Polling slows when you go idle, backs off when no PR is found, and stops after an hour without activity.

Custom footers must display extension statuses via `footerData.getExtensionStatuses()`.

## Test

```bash
pnpm --filter @saadjs/pi-git-status test
```
