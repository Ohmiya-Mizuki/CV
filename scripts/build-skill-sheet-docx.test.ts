import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildSkillSheetDocx } from "./build-skill-sheet-docx.ts";
import { hasCommand, initRepo, SHEET, tempDir, writeFile } from "./test-helpers.ts";

const scripts = dirname(fileURLToPath(import.meta.url));
const EXCLUDED = "| スキルシートの案件名 | 期間 |\n| --- | --- |\n| 載せない案件 | 2025 |\n| もうない案件 | 2024 |\n";

/** 雛形・スクリプト・載せない案件の一覧を置いたリポジトリと、その外にあるスキルシートを作る */
function setup(): { repo: string; sheet: string } {
  const base = tempDir();
  const repo = initRepo(join(base, "CV"), { "docs/cv-excluded-projects.md": EXCLUDED });
  mkdirSync(join(repo, "templates"));
  copyFileSync(join(scripts, "..", "templates", "reference.docx"), join(repo, "templates", "reference.docx"));
  mkdirSync(join(repo, "scripts"));
  for (const file of ["build-skill-sheet-docx.ts", "build-docx.ts", "docx.ts", "skill-sheet.ts", "draft-notes.ts"]) {
    copyFileSync(join(scripts, file), join(repo, "scripts", file));
  }
  const sheet = join(base, "life", "skill-sheet.md");
  writeFile(sheet, SHEET);
  return { repo, sheet };
}

const documentXml = (docx: string): string => execFileSync("unzip", ["-p", docx, "word/document.xml"], { encoding: "utf8" });

describe("buildSkillSheetDocx", { skip: !hasCommand("pandoc") && "pandoc がない" }, () => {
  test("全案件を載せ、【要記入】の行を外し、経験件数を数え直す", () => {
    const { repo, sheet } = setup();
    const result = buildSkillSheetDocx(repo, sheet, { fileName: "all.docx" });

    assert.equal(result.out, join(repo, ".local", "cv", "all.docx"));
    const xml = documentXml(result.out);
    assert.match(xml, /載せない案件/);
    assert.doesNotMatch(xml, /【要記入】/);
    assert.deepEqual(result.excluded, []);
    assert.ok(result.changes.some((c) => c.process === "実装" && c.after === "有・3件"));
    // 【要記入】の行は外れるので、警告の対象にならない
    assert.deepEqual(result.draftNotes, []);
  });

  test("Word にした文章に作業メモのような文言が残っていれば返す", () => {
    const { repo, sheet } = setup();
    writeFile(sheet, SHEET.replace("| 担当工程 | 実装 |", "| 担当工程 | 実装 |\n| 解決した課題 | レビュー中 |"));
    const result = buildSkillSheetDocx(repo, sheet, { fileName: "note.docx" });
    assert.deepEqual(
      result.draftNotes.map((n) => n.text),
      ["| 解決した課題 | レビュー中 |"],
    );
  });

  test("exclude で一覧の案件を外し、見つからない名前を返す", () => {
    const { repo, sheet } = setup();
    const result = buildSkillSheetDocx(repo, sheet, { exclude: true, fileName: "ex.docx" });

    const xml = documentXml(result.out);
    assert.doesNotMatch(xml, /載せない案件/);
    assert.match(xml, /古い案件/);
    assert.deepEqual(result.excluded, ["載せない案件"]);
    assert.deepEqual(result.notFound, ["もうない案件"]);
    assert.ok(result.changes.some((c) => c.process === "実装" && c.after === "有・2件"));
  });

  test("スキルシートがなければ止まる", () => {
    const { repo } = setup();
    assert.throws(() => buildSkillSheetDocx(repo, join(repo, "missing.md")), /スキルシートがありません/);
  });
});

describe("コマンドとして実行", { skip: !hasCommand("pandoc") && "pandoc がない" }, () => {
  const run = (repo: string, env: Record<string, string | undefined>, ...args: string[]) => {
    const { CV_SKILL_SHEET: _sheet, ...rest } = process.env;
    return spawnSync("node", [join(repo, "scripts", "build-skill-sheet-docx.ts"), ...args], {
      encoding: "utf8",
      env: { ...rest, CV_DOCX_SKIP_PDF: "1", ...env },
    });
  };

  test("--exclude で外した案件と警告を表示する", () => {
    const { repo, sheet } = setup();
    const result = run(repo, { CV_SKILL_SHEET: sheet }, "--exclude", "cli.docx");

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /外した案件: 載せない案件/);
    assert.match(result.stderr, /スキルシートに見つからない案件名: もうない案件/);
    assert.match(result.stderr, /実装: 有・9件 → 有・2件/);
    assert.ok(existsSync(join(repo, ".local", "cv", "cli.docx")));
  });

  test("CV_SKILL_SHEET が未設定なら終了コード 2", () => {
    const { repo } = setup();
    const result = run(repo, {});
    assert.equal(result.status, 2);
    assert.match(result.stderr, /CV_SKILL_SHEET が未設定です/);
  });

  test("スキルシートがなければ終了コード 2", () => {
    const { repo } = setup();
    const result = run(repo, { CV_SKILL_SHEET: join(repo, "missing.md") });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /スキルシートがありません/);
  });
});
