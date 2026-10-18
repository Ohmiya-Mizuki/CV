import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { git, initRepo, tempDir } from "./test-helpers.ts";

const script = join(dirname(fileURLToPath(import.meta.url)), "list-evidence-repos.sh");

function run(env: Record<string, string | undefined>) {
  const { CV_EVIDENCE_DIRS: _dirs, CV_EVIDENCE_EXCLUDE: _exclude, ...rest } = process.env;
  return spawnSync("bash", [script], { encoding: "utf8", env: { ...rest, ...env } });
}

const lines = (stdout: string): string[] => stdout.trim().split("\n").filter(Boolean);

describe("list-evidence-repos.sh", () => {
  test("CV_EVIDENCE_DIRS が未設定なら終了コード 2", () => {
    const result = run({});
    assert.equal(result.status, 2);
    assert.match(result.stderr, /CV_EVIDENCE_DIRS が未設定です/);
  });

  test("指定したディレクトリがなければ終了コード 2", () => {
    const result = run({ CV_EVIDENCE_DIRS: join(tempDir(), "missing") });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /存在しません/);
  });

  test("6 階層下までのリポジトリを列挙し、除外・隠し・node_modules・worktree の重複を除く", () => {
    const base = tempDir();
    const a = initRepo(join(base, "a"));
    const b = initRepo(join(base, "org", "b"));
    const deep = initRepo(join(base, "org", "x", "y", "z", "c")); // .git は 6 階層目
    initRepo(join(base, "d", "1", "2", "3", "4", "e")); // .git は 7 階層目なので対象外
    initRepo(join(base, "archive", "old"));
    initRepo(join(base, "node_modules", "pkg"));
    initRepo(join(base, ".cache", "hidden"));
    git(a, "worktree", "add", "-q", "-b", "wt", join(base, "a-wt"));

    const result = run({ CV_EVIDENCE_DIRS: base, CV_EVIDENCE_EXCLUDE: "archive" });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(lines(result.stdout), [a, b, deep].sort());
  });

  test("CV_EVIDENCE_DIRS と CV_EVIDENCE_EXCLUDE は : 区切りで複数指定できる", () => {
    const one = tempDir();
    const two = tempDir();
    const r1 = initRepo(join(one, "r1"));
    const r2 = initRepo(join(two, "r2"));
    initRepo(join(one, "skip1", "x"));
    initRepo(join(two, "skip2", "y"));

    const result = run({ CV_EVIDENCE_DIRS: `${one}:${two}`, CV_EVIDENCE_EXCLUDE: "skip1:skip2" });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(lines(result.stdout), [r1, r2].sort());
  });
});
