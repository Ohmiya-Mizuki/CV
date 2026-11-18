import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { git, initRepo, tempDir, writeFile } from "./test-helpers.ts";

const script = join(dirname(fileURLToPath(import.meta.url)), "fetch-evidence-repos.sh");

function run(repos: string[], env: Record<string, string> = {}) {
  const { CV_EVIDENCE_FETCH_TIMEOUT: _timeout, ...rest } = process.env;
  return spawnSync("bash", [script], {
    encoding: "utf8",
    input: repos.map((r) => `${r}\n`).join(""),
    env: { ...rest, ...env },
  });
}

const rows = (stdout: string): string[][] =>
  stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));

/** リモート（bare）と、そこから clone した手元のリポジトリを作る */
function cloneWithRemote(base: string, name: string): { remote: string; local: string; other: string } {
  const seed = initRepo(join(base, `${name}-seed`));
  const remote = join(base, `${name}.git`);
  git(base, "clone", "-q", "--bare", seed, remote);
  const local = join(base, name);
  git(base, "clone", "-q", remote, local);
  const other = join(base, `${name}-other`);
  git(base, "clone", "-q", remote, other);
  return { remote, local, other };
}

function commit(repo: string, file: string, message: string): string {
  writeFile(join(repo, file), `${message}\n`);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

describe("fetch-evidence-repos.sh", () => {
  test("リモートの新しいコミットを取り込み、作業ツリーとローカルのブランチを変えない", () => {
    const base = tempDir();
    const { local, other } = cloneWithRemote(base, "a");
    // ほかの端末で作業して push したコミット
    const pushed = commit(other, "remote.txt", "remote work");
    git(other, "push", "-q", "origin", "main");
    // 手元にしかないコミットと、コミットしていない変更
    const localHead = commit(local, "local.txt", "local only");
    writeFile(join(local, "dirty.txt"), "uncommitted\n");

    const result = run([local]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(rows(result.stdout), [["fetched", local]]);
    assert.equal(git(local, "rev-parse", "origin/main"), pushed);
    assert.equal(git(local, "rev-parse", "main"), localHead);
    assert.equal(readFileSync(join(local, "dirty.txt"), "utf8"), "uncommitted\n");
    assert.match(git(local, "status", "--porcelain"), /dirty\.txt/);
    assert.match(git(local, "log", "--all", "--format=%s"), /remote work/);
  });

  test("リモートで消えたブランチの控えを残す（fetch.prune が有効でも）", () => {
    const base = tempDir();
    const { local, other } = cloneWithRemote(base, "b");
    git(other, "checkout", "-q", "-b", "feature");
    const onFeature = commit(other, "feature.txt", "feature work");
    git(other, "push", "-q", "origin", "feature");
    git(local, "fetch", "-q", "--all");
    git(other, "push", "-q", "origin", "--delete", "feature");
    git(local, "config", "fetch.prune", "true");

    const result = run([local]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(rows(result.stdout), [["fetched", local]]);
    assert.equal(git(local, "rev-parse", "origin/feature"), onFeature);
  });

  test("リモートのないリポジトリは no-remote、読めないリモートは failed にして、止まらない", () => {
    const base = tempDir();
    const noRemote = initRepo(join(base, "no-remote"));
    const broken = initRepo(join(base, "broken"));
    git(broken, "remote", "add", "origin", join(base, "missing.git"));
    const { local } = cloneWithRemote(base, "ok");

    const result = run([noRemote, broken, local]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(rows(result.stdout), [
      ["no-remote", noRemote],
      ["failed", broken],
      ["fetched", local],
    ]);
  });

  test("リモートの1つでも読めなければ failed にする", () => {
    const base = tempDir();
    const { local } = cloneWithRemote(base, "two");
    git(local, "remote", "add", "second", join(base, "missing.git"));

    const result = run([local]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(rows(result.stdout), [["failed", local]]);
  });

  test("応答のないリモートは、時間で打ち切って failed にする", () => {
    const base = tempDir();
    const hung = initRepo(join(base, "hung"));
    git(hung, "remote", "add", "origin", "ext::sleep 20");
    const started = Date.now();

    const result = run([hung], {
      CV_EVIDENCE_FETCH_TIMEOUT: "1",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "protocol.ext.allow",
      GIT_CONFIG_VALUE_0: "always",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(rows(result.stdout), [["failed", hung]]);
    assert.ok(Date.now() - started < 10_000, "打ち切りが効いていない");
  });

  test("Git のリポジトリでないパスは failed にする", () => {
    const base = tempDir();

    const result = run([join(base, "nothing")]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(rows(result.stdout), [["failed", join(base, "nothing")]]);
  });

  test("打ち切りの秒数が数字でなければ終了コード 2", () => {
    const result = run([], { CV_EVIDENCE_FETCH_TIMEOUT: "abc" });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /CV_EVIDENCE_FETCH_TIMEOUT/);
  });
});
