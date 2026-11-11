import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { initRepo, tempDir, writeFile } from "./test-helpers.ts";

const script = join(dirname(fileURLToPath(import.meta.url)), "evidence-log.sh");

function run(args: string[], env: Record<string, string> = {}) {
  const { CV_EVIDENCE_AUTHORS: _authors, ...rest } = process.env;
  return spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...rest, ...env } });
}

function commitAs(repo: string, name: string, email: string, message: string): void {
  writeFile(join(repo, `${message}.txt`), `${message}\n`);
  const as = ["-c", `user.name=${name}`, "-c", `user.email=${email}`, "-C", repo];
  execFileSync("git", [...as, "add", "-A"]);
  execFileSync("git", [...as, "commit", "-q", "-m", message]);
}

const subjects = (stdout: string): string[] => stdout.trim().split("\n").filter(Boolean).sort();

/** 本人の名前・本人のメール・貸与PCのメール・他人のコミットが1つずつあるリポジトリ */
function repoWithAuthors(): string {
  const repo = initRepo(join(tempDir(), "r"));
  commitAs(repo, "Ohmiya-Mizuki", "someone@example.com", "by-name");
  commitAs(repo, "Other Name", "m7xtgrmd.works@gmail.com", "by-email");
  commitAs(repo, "Lent Pc", "lent@client.example", "by-lent-email");
  commitAs(repo, "Coworker", "coworker@example.com", "by-coworker");
  return repo;
}

describe("evidence-log.sh", () => {
  test("設定がなければ、本人の名前とメールのコミットだけを数える", () => {
    const repo = repoWithAuthors();

    const result = run([repo, "--format=%s"]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(subjects(result.stdout), ["by-email", "by-name"]);
  });

  test("CV_EVIDENCE_AUTHORS に足した名前・メールのコミットも数える（: 区切りで複数）", () => {
    const repo = repoWithAuthors();

    const result = run([repo, "--format=%s"], { CV_EVIDENCE_AUTHORS: "lent@client.example:Nobody" });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(subjects(result.stdout), ["by-email", "by-lent-email", "by-name"]);
  });

  test("作者は正規表現ではなく、文字のとおりに照らす", () => {
    const repo = repoWithAuthors();

    const result = run([repo, "--format=%s"], { CV_EVIDENCE_AUTHORS: "c.w.rker@example.com" });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(subjects(result.stdout), ["by-email", "by-name"]);
  });

  test("ローカルにないブランチ（リモートの控え）のコミットも数え、git log の引数を渡せる", () => {
    const repo = repoWithAuthors();
    execFileSync("git", ["-C", repo, "update-ref", "refs/remotes/origin/feature", "HEAD"]);
    execFileSync("git", ["-C", repo, "reset", "-q", "--hard", "HEAD~4"]);

    const all = run([repo, "--format=%s"]);
    const last = run([repo, "-1", "--format=%s"]);

    assert.deepEqual(subjects(all.stdout), ["by-email", "by-name"]);
    assert.deepEqual(subjects(last.stdout), ["by-email"]);
  });

  test("リポジトリの指定がなければ終了コード 2", () => {
    const result = run([]);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /使い方/);
  });
});
