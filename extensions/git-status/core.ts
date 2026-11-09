import { execFile } from "node:child_process";

export interface GitStatus {
  branch: string;
  changed: number;
  untracked: number;
  added: number;
  removed: number;
}

export interface WorkingTreeStatus {
  branch: string;
  unborn: boolean;
  changed: number;
  untracked: number;
}

/** Parse porcelain v1 -z, skipping the extra source path on rename/copy records. */
export function parseWorkingTree(output: string): WorkingTreeStatus {
  const records = output.split("\0");
  const header = records.shift() ?? "";
  const unborn = /^## (No commits yet on |Initial commit on )/.test(header);
  const branch = header.startsWith("## HEAD (no branch)")
    ? "detached"
    : header
        .replace(/^## (?:No commits yet on |Initial commit on )?/, "")
        .split("...")[0]
        .replace(/ \[.*\]$/, "");
  let changed = 0;
  let untracked = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    const status = record.slice(0, 2);
    if (status === "??") untracked++;
    else if (status !== "!!") changed++;
    if (/[RC]/.test(status)) i++;
  }

  return { branch, unborn, changed, untracked };
}

/** Binary files report '-' instead of line counts; rename paths are separate NUL records. */
export function parseNumstat(output: string): Pick<GitStatus, "added" | "removed"> {
  const records = output.split("\0");
  let added = 0;
  let removed = 0;
  for (let i = 0; i < records.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(records[i]);
    if (!match) continue;
    if (match[1] !== "-") added += Number(match[1]);
    if (match[2] !== "-") removed += Number(match[2]);
    if (match[3] === "") i += 2;
  }
  return { added, removed };
}

function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      ["-c", "color.ui=false", ...args],
      {
        cwd,
        signal,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
    // hash-object --stdin needs EOF to hash the empty tree (including SHA-256 repos).
    child.stdin?.end();
  });
}

/** Net tracked-file changes against HEAD; untracked contents are deliberately excluded. */
export async function readGitStatus(cwd: string, signal?: AbortSignal): Promise<GitStatus | null> {
  try {
    const status = parseWorkingTree(
      await git(
        cwd,
        ["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all", "--renames"],
        signal,
      ),
    );
    // Before the first commit, compare the working tree to an empty tree instead of HEAD.
    const base = status.unborn
      ? (await git(cwd, ["hash-object", "-t", "tree", "--stdin"], signal)).trim()
      : "HEAD";
    const diff = await git(
      cwd,
      [
        "diff",
        "--numstat",
        "-z",
        "--no-ext-diff",
        "--no-textconv",
        "--no-relative",
        "--find-renames",
        base,
        "--",
      ],
      signal,
    );
    return {
      branch: status.branch,
      changed: status.changed,
      untracked: status.untracked,
      ...parseNumstat(diff),
    };
  } catch {
    // Not a repository, Git unavailable, timeout, or cancellation: don't leave stale counts.
    return null;
  }
}

export type PullRequestState = "open" | "draft" | "merged" | "closed";

export interface PullRequest {
  number: number;
  url: string;
  state: PullRequestState;
}

/** `null` means the branch has no PR; `"unavailable"` means gh is missing or signed out. */
export type PullRequestLookup = PullRequest | null | "unavailable";

export function parsePullRequest(output: string): PullRequest | null {
  try {
    const data: unknown = JSON.parse(output);
    if (typeof data !== "object" || data === null) return null;
    const { number, url, state, isDraft } = data as Record<string, unknown>;
    if (typeof number !== "number" || typeof url !== "string" || !url.startsWith("https://")) {
      return null;
    }
    if (state === "OPEN") return { number, url, state: isDraft === true ? "draft" : "open" };
    if (state === "MERGED") return { number, url, state: "merged" };
    if (state === "CLOSED") return { number, url, state: "closed" };
    return null;
  } catch {
    return null;
  }
}

/** Looks up the PR for the checked-out branch, including merged and closed ones. */
export function readPullRequest(cwd: string, signal?: AbortSignal): Promise<PullRequestLookup> {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      ["pr", "view", "--json", "number,url,state,isDraft"],
      {
        cwd,
        signal,
        env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" },
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(parsePullRequest(stdout));
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return resolve("unavailable");
        if (/no (pull requests|open pull requests) found/i.test(stderr)) return resolve(null);
        if (/gh auth login|authentication|bad credentials/i.test(stderr)) {
          return resolve("unavailable");
        }
        // Network errors, rate limits, non-GitHub remotes: let the caller keep the last result.
        reject(error);
      },
    );
  });
}

/** OSC 8 terminal hyperlink. */
export function hyperlink(url: string, text: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

const PR_COLORS: Record<PullRequestState, StatusColor> = {
  open: "success",
  draft: "muted",
  merged: "accent",
  closed: "error",
};

type StatusColor = "text" | "accent" | "muted" | "success" | "error";

export function formatGitStatus(
  status: GitStatus,
  color: (name: StatusColor, text: string) => string = (_name, text) => text,
  pr?: PullRequest | null,
): string {
  const separator = color("muted", " • ");
  const head = [color("text", status.branch)];
  if (pr) head.push(hyperlink(pr.url, color(PR_COLORS[pr.state], `#${pr.number}`)));
  if (status.changed === 0 && status.untracked === 0) {
    return [...head, color("success", "clean")].join(separator);
  }
  return [
    ...head,
    color(status.changed ? "accent" : "muted", `${status.changed} changed`),
    color("muted", `${status.untracked} untracked`),
    `${color(status.added ? "success" : "muted", `+${status.added}`)} ${color(status.removed ? "error" : "muted", `−${status.removed}`)}`,
  ].join(separator);
}
