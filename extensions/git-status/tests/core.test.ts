import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { formatGitStatus, parseNumstat, parseWorkingTree, readGitStatus } from "../core.ts";

function repo() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-git-status-"));
  function git(...args: string[]) {
    return execFileSync(
      "git",
      ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  }
  git("init", "--initial-branch=main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "core.autocrlf", "false");
  function file(name: string, content: string | Buffer) {
    writeFileSync(join(cwd, name), content);
  }
  function commit() {
    git("add", ".");
    git("commit", "-m", "test");
  }
  return { cwd, git, file, commit, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

describe("parsing and formatting", () => {
  it("counts each tracked entry once and handles rename source paths and unusual filenames", () => {
    assert.deepEqual(
      parseWorkingTree(
        "## main...origin/main [ahead 1]\0MM both.ts\0R  new\tfile\n.ts\0?? old source\0?? folder/a\0?? folder/b\0 D deleted\0UU conflict\0!! ignored\0",
      ),
      { branch: "main", unborn: false, changed: 4, untracked: 2 },
    );
  });

  it("recognizes unborn branches and detached HEAD", () => {
    for (const prefix of ["No commits yet on ", "Initial commit on "]) {
      assert.deepEqual(parseWorkingTree(`## ${prefix}feature/foo\0`), {
        branch: "feature/foo",
        unborn: true,
        changed: 0,
        untracked: 0,
      });
    }
    assert.equal(parseWorkingTree("## HEAD (no branch)\0").branch, "detached");
  });

  it("sums numstat without treating binary files or rename paths as line counts", () => {
    assert.deepEqual(
      parseNumstat(
        "12\t3\tfile\tname\n.ts\0-\t-\tbinary\0" +
          "2\t5\t\0old\0" +
          "999\t999\tnew\0" +
          "0\t1\tdeleted\0",
      ),
      { added: 14, removed: 9 },
    );
  });

  it("formats dirty and clean states as plain text", () => {
    const dirty = { branch: "main", changed: 3, untracked: 2, added: 42, removed: 17 };
    assert.equal(formatGitStatus(dirty), "main • 3 changed • 2 untracked • +42 −17");
    assert.equal(
      formatGitStatus({ ...dirty, changed: 0, untracked: 0, added: 0, removed: 0 }),
      "main • clean",
    );
    assert.equal(
      formatGitStatus({ ...dirty, changed: 0 }),
      "main • 0 changed • 2 untracked • +42 −17",
    );
    assert.equal(
      formatGitStatus({ ...dirty, untracked: 0 }),
      "main • 3 changed • 0 untracked • +42 −17",
    );
  });

  it("uses semantic theme colors and mutes zero counts", () => {
    const color = (name: string, text: string) => `<${name}>${text}</${name}>`;
    const dirty = { branch: "main", changed: 3, untracked: 2, added: 42, removed: 17 };
    assert.equal(
      formatGitStatus(dirty, color),
      "<text>main</text><muted> • </muted><accent>3 changed</accent>" +
        "<muted> • </muted><muted>2 untracked</muted>" +
        "<muted> • </muted><success>+42</success> <error>−17</error>",
    );
    assert.equal(
      formatGitStatus({ ...dirty, changed: 0, untracked: 0, added: 0, removed: 0 }, color),
      "<text>main</text><muted> • </muted><success>clean</success>",
    );
    assert.equal(
      formatGitStatus({ ...dirty, changed: 0, added: 0, removed: 0 }, color),
      "<text>main</text><muted> • </muted><muted>0 changed</muted>" +
        "<muted> • </muted><muted>2 untracked</muted>" +
        "<muted> • </muted><muted>+0</muted> <muted>−0</muted>",
    );
  });
});

describe("real Git repositories", () => {
  it("combines staged and unstaged changes as a net HEAD diff, counting files once", async (t) => {
    const r = repo();
    t.after(r.cleanup);
    r.file("both.txt", "one\ntwo\nthree\n");
    r.file("deleted.txt", "delete me\n");
    r.file(".gitignore", "ignored.txt\n");
    r.commit();
    r.file("both.txt", "ONE\ntwo\nthree\nfour\n");
    r.git("add", "both.txt");
    r.file("both.txt", "ONE\ntwo\nthree\nfour\nfive\n");
    r.file("new.txt", "new tracked\n");
    r.git("add", "new.txt");
    rmSync(join(r.cwd, "deleted.txt"));
    mkdirSync(join(r.cwd, "folder"));
    r.file("folder/a", "not in line counts\n");
    r.file("folder/b", "also untracked\n");
    r.file("ignored.txt", "ignored\n");
    assert.deepEqual(await readGitStatus(r.cwd), {
      branch: "main",
      changed: 3,
      untracked: 2,
      added: 4,
      removed: 2,
    });
    // A nested CWD and diff.relative configuration must not narrow the counts.
    r.git("config", "diff.relative", "true");
    assert.deepEqual(await readGitStatus(join(r.cwd, "folder")), await readGitStatus(r.cwd));
  });

  it("does not double-count changes that cancel between staging and the working tree", async (t) => {
    const r = repo();
    t.after(r.cleanup);
    r.file("a", "original\n");
    r.commit();
    r.file("a", "staged\n");
    r.git("add", "a");
    r.file("a", "original\n");
    assert.deepEqual(await readGitStatus(r.cwd), {
      branch: "main",
      changed: 1,
      untracked: 0,
      added: 0,
      removed: 0,
    });
  });

  it("supports empty repositories and staged/unstaged additions before the first commit", async (t) => {
    const r = repo();
    t.after(r.cleanup);
    assert.deepEqual(await readGitStatus(r.cwd), {
      branch: "main",
      changed: 0,
      untracked: 0,
      added: 0,
      removed: 0,
    });
    r.file("new", "one\n");
    r.git("add", "new");
    r.file("new", "one\ntwo\n");
    r.file("untracked", "excluded\n");
    assert.deepEqual(await readGitStatus(r.cwd), {
      branch: "main",
      changed: 1,
      untracked: 1,
      added: 2,
      removed: 0,
    });
  });

  it("handles renames, binary files, clean trees, and detached HEAD", async (t) => {
    const r = repo();
    t.after(r.cleanup);
    r.file("old name\twith tab", "one\ntwo\nthree\n");
    r.file("binary", Buffer.from([0, 1, 2]));
    r.commit();
    assert.equal(formatGitStatus((await readGitStatus(r.cwd))!), "main • clean");
    renameSync(join(r.cwd, "old name\twith tab"), join(r.cwd, "new name\nwith newline"));
    r.git("add", "-A");
    r.file("binary", Buffer.from([0, 3, 4]));
    assert.deepEqual(await readGitStatus(r.cwd), {
      branch: "main",
      changed: 2,
      untracked: 0,
      added: 0,
      removed: 0,
    });
    r.git("checkout", "--detach", "HEAD");
    assert.equal((await readGitStatus(r.cwd))?.branch, "detached");
  });

  for (const setting of ["status.renames", "diff.renames"]) {
    it(`counts a staged rename once even when ${setting}=false`, async (t) => {
      const r = repo();
      t.after(r.cleanup);
      r.file("old", "one\ntwo\nthree\n");
      r.commit();
      renameSync(join(r.cwd, "old"), join(r.cwd, "new"));
      r.git("add", "-A");
      r.git("config", setting, "false");

      assert.deepEqual(await readGitStatus(r.cwd), {
        branch: "main",
        changed: 1,
        untracked: 0,
        added: 0,
        removed: 0,
      });
    });
  }

  it("counts merge conflicts as changed files", async (t) => {
    const r = repo();
    t.after(r.cleanup);
    r.file("a", "base\n");
    r.commit();
    r.git("checkout", "-b", "other");
    r.file("a", "other\n");
    r.commit();
    r.git("checkout", "main");
    r.file("a", "main\n");
    r.commit();
    assert.throws(() => r.git("merge", "other"));
    const status = await readGitStatus(r.cwd);
    assert.equal(status?.changed, 1);
    assert.equal(status?.untracked, 0);
  });

  it("hides status outside repositories and when canceled", async (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-no-git-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    assert.equal(await readGitStatus(cwd), null);
    assert.equal(await readGitStatus(cwd, AbortSignal.abort()), null);
  });
});
