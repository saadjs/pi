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

type StatusColor = "text" | "accent" | "muted" | "success" | "error";

export function formatGitStatus(
  status: GitStatus,
  color: (name: StatusColor, text: string) => string = (_name, text) => text,
): string {
  const separator = color("muted", " • ");
  if (status.changed === 0 && status.untracked === 0) {
    return color("text", status.branch) + separator + color("success", "clean");
  }
  return [
    color("text", status.branch),
    color(status.changed ? "accent" : "muted", `${status.changed} changed`),
    color("muted", `${status.untracked} untracked`),
    `${color(status.added ? "success" : "muted", `+${status.added}`)} ${color(status.removed ? "error" : "muted", `−${status.removed}`)}`,
  ].join(separator);
}
