// スキルシート（CV_SKILL_SHEET）から提出用の Word と PDF を作る。出力は本体のチェックアウトの .local/cv/。
// 「担当可能な工程」の経験件数は各案件から数え直し、【要記入】の行は外す（スキルシート自体は変えない）。
//   使い方: node scripts/build-skill-sheet-docx.ts [--exclude] [出力ファイル名]
//   --exclude で docs/cv-excluded-projects.md の案件を外す
//   CV_DOCX_SKIP_PDF=1 で PDF を作らない
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultFileName, renderDocx, reportPdf } from "./build-docx.ts";
import {
  dropPlaceholderRows,
  excludeProjects,
  parseExcludedNames,
  recountProcesses,
  widenTableColumns,
  type ProcessChange,
} from "./skill-sheet.ts";

export type SkillSheetResult = {
  out: string;
  excluded: string[];
  notFound: string[];
  changes: ProcessChange[];
};

/** スキルシートを加工して docx を作る */
export function buildSkillSheetDocx(
  repoRoot: string,
  skillSheet: string,
  options: { exclude?: boolean; fileName?: string } = {},
): SkillSheetResult {
  if (!existsSync(skillSheet)) {
    throw new Error(`スキルシートがありません: ${skillSheet}`);
  }
  let markdown = readFileSync(skillSheet, "utf8");
  let excluded: string[] = [];
  let notFound: string[] = [];
  if (options.exclude) {
    const list = join(repoRoot, "docs", "cv-excluded-projects.md");
    const names = existsSync(list) ? parseExcludedNames(readFileSync(list, "utf8")) : [];
    ({ markdown, excluded, notFound } = excludeProjects(markdown, names));
  }
  const recounted = recountProcesses(markdown);
  markdown = widenTableColumns(dropPlaceholderRows(recounted.markdown));
  const fileName =
    options.fileName ?? defaultFileName(new Date(), options.exclude ? "スキルシート_載せない案件を除外" : "スキルシート");
  return { out: renderDocx(repoRoot, markdown, fileName), excluded, notFound, changes: recounted.changes };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const exclude = args.includes("--exclude");
  const fileName = args.find((arg) => !arg.startsWith("--"));
  const skillSheet = process.env.CV_SKILL_SHEET;
  if (!skillSheet) {
    console.error("CV_SKILL_SHEET が未設定です。.claude/settings.local.json の env に設定してください。");
    process.exit(2);
  }
  if (spawnSync("sh", ["-c", "command -v pandoc"]).status !== 0) {
    console.error("pandoc が見つかりません。");
    process.exit(2);
  }
  const repoRoot = execFileSync("git", ["-C", dirname(fileURLToPath(import.meta.url)), "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  let result: SkillSheetResult;
  try {
    result = buildSkillSheetDocx(repoRoot, skillSheet, { exclude, fileName });
  } catch (error) {
    console.error((error as Error).message);
    process.exit(2);
  }
  console.log(result.out);
  if (exclude) console.log(`外した案件: ${result.excluded.length ? result.excluded.join("、") : "なし"}`);
  for (const name of result.notFound) {
    console.error(`警告: 載せない案件の一覧にあるが、スキルシートに見つからない案件名: ${name}`);
  }
  if (result.changes.length) {
    console.error("注意: 「担当可能な工程」の経験件数を各案件から数え直した（スキルシート自体は変えていない）:");
    for (const { process: name, before, after } of result.changes) console.error(`  ${name}: ${before} → ${after}`);
  }
  reportPdf(result.out);
}
