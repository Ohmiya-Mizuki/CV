import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildDocx, countPdfPages, defaultFileName, outputDir, stripRules } from "./build-docx.ts";
import { git, hasCommand, initRepo, tempDir } from "./test-helpers.ts";

const scripts = dirname(fileURLToPath(import.meta.url));
const reference = join(scripts, "..", "templates", "reference.docx");

const README = `# 業務経歴書

## 職務要約

テスト用の本文。

---

## スキル

| 分類 | 技術 |
| ---- | ---------------- |
| 言語 | TypeScript（5 年） |
`;

/** 本体のリポジトリと、その worktree を作る */
function repoWithWorktree(): { main: string; worktree: string } {
  const base = tempDir();
  const main = initRepo(join(base, "CV"), { "README.md": README });
  mkdirSync(join(main, "templates"));
  copyFileSync(reference, join(main, "templates", "reference.docx"));
  const worktree = join(base, "CV-worktrees", "wt");
  git(main, "worktree", "add", "-q", "-b", "wt", worktree);
  // templates/ はコミットしていないため、worktree 側にも置く
  mkdirSync(join(worktree, "templates"));
  copyFileSync(reference, join(worktree, "templates", "reference.docx"));
  return { main, worktree };
}

describe("stripRules", () => {
  test("区切り線の行だけを消す", () => {
    assert.equal(stripRules("a\n---\nb\n"), "a\nb\n");
  });

  test("表の区切り行や長い罫線は残す", () => {
    const md = "| a |\n| --- |\n----\n --- \n";
    assert.equal(stripRules(md), md);
  });
});

describe("countPdfPages", () => {
  test("/Type /Page を数え、/Pages は数えない", () => {
    const pdf = Buffer.from("<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type/Page >>", "latin1");
    assert.equal(countPdfPages(pdf), 2);
  });

  test("ページがなければ 0", () => {
    assert.equal(countPdfPages(Buffer.from("")), 0);
  });
});

describe("defaultFileName", () => {
  test("日付を YYYYMMDD で付ける", () => {
    assert.equal(defaultFileName(new Date(2026, 9, 5)), "業務経歴書_20261005.docx");
  });
});

describe("outputDir", () => {
  test("本体のチェックアウトでは、その .local/cv", () => {
    const { main } = repoWithWorktree();
    assert.equal(outputDir(main), join(main, ".local", "cv"));
  });

  test("worktree で実行しても、本体のチェックアウトの .local/cv", () => {
    const { main, worktree } = repoWithWorktree();
    assert.equal(outputDir(worktree), join(main, ".local", "cv"));
  });
});

describe("buildDocx", { skip: !hasCommand("pandoc") && "pandoc がない" }, () => {
  test("README.md から docx を作り、本体の .local/cv に出す", () => {
    const { main, worktree } = repoWithWorktree();
    const out = buildDocx(worktree, "test.docx");

    assert.equal(out, join(main, ".local", "cv", "test.docx"));
    const xml = execFileSync("unzip", ["-p", out, "word/document.xml"], { encoding: "utf8" });
    assert.match(xml, /職務要約/);
    assert.match(xml, /<w:tbl>/);
    // 雛形の A4 が使われている
    const pgSz = xml.match(/<w:pgSz [^>]*>/)?.[0] ?? "";
    assert.match(pgSz, /w:w="11906"/);
    assert.match(pgSz, /w:h="16838"/);
  });

  test("雛形がなければ止まる", () => {
    const repo = initRepo(join(tempDir(), "CV"), { "README.md": README });
    assert.throws(() => buildDocx(repo, "test.docx"), /雛形がありません/);
  });
});

describe("コマンドとして実行", { skip: !hasCommand("pandoc") && "pandoc がない" }, () => {
  function run(cwd: string, ...args: string[]) {
    // リポジトリの中にスクリプトを置いて実行する（スクリプトの場所からリポジトリを決めるため）
    mkdirSync(join(cwd, "scripts"), { recursive: true });
    for (const file of ["build-docx.ts", "docx.ts"]) copyFileSync(join(scripts, file), join(cwd, "scripts", file));
    return spawnSync("node", [join(cwd, "scripts", "build-docx.ts"), ...args], {
      encoding: "utf8",
      env: { ...process.env, CV_DOCX_SKIP_PDF: "1" },
    });
  }

  test("出力先のパスを表示して終了コード 0", () => {
    const { main } = repoWithWorktree();
    const result = run(main, "cli.docx");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), join(main, ".local", "cv", "cli.docx"));
    assert.ok(existsSync(join(main, ".local", "cv", "cli.docx")));
  });

  test("雛形がなければ終了コード 2", () => {
    const repo = initRepo(join(tempDir(), "CV"), { "README.md": README });
    const result = run(repo);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /雛形がありません/);
  });
});
