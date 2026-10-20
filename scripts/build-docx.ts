// README.md（業務経歴書の正本）から提出用の Word と PDF を作る。
// 出力は本体のチェックアウトの .local/cv/（gitignore済み）。PDF は LibreOffice がある場合だけ作り、ページ数も表示する。
//   使い方: node scripts/build-docx.ts [出力ファイル名]
//   CV_DOCX_SKIP_PDF=1 で PDF を作らない
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { patchDocx } from "./docx.ts";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

export const hasCommand = (name: string): boolean => spawnSync("sh", ["-c", `command -v ${name}`]).status === 0;

/** 区切り線（---）は Word では余計な罫線になるため外し、見出しで区切る */
export function stripRules(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => line !== "---")
    .join("\n");
}

/** worktree で実行しても、本体のチェックアウトの .local/cv/ に出す（worktree を消しても残るように） */
export function outputDir(repoRoot: string): string {
  const commonDir = git(repoRoot, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return join(dirname(commonDir), ".local", "cv");
}

/** PDF のページ数を数える（/Type /Page の数。/Pages は除く） */
export function countPdfPages(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
}

export function defaultFileName(date: Date = new Date(), prefix = "業務経歴書"): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${prefix}_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.docx`;
}

/** Markdown を雛形の見た目で docx にし、本体のチェックアウトの .local/cv/ に出す。出力先のパスを返す */
export function renderDocx(repoRoot: string, markdown: string, fileName: string): string {
  const reference = join(repoRoot, "templates", "reference.docx");
  if (!existsSync(reference)) {
    throw new Error("雛形がありません: node scripts/make-reference-docx.ts を実行してください。");
  }
  const dir = outputDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const out = join(dir, fileName);
  // 表の列幅を区切り行の「-」の数から決めるため、pandoc の markdown として読み、--columns を小さくする
  execFileSync(
    "pandoc",
    ["--from", "markdown+autolink_bare_uris", "--to", "docx", "--columns", "20", "--reference-doc", reference, "--output", out],
    { input: markdown },
  );
  return out;
}

/** README.md から docx を作り、出力先のパスを返す */
export function buildDocx(repoRoot: string, fileName: string = defaultFileName()): string {
  return renderDocx(repoRoot, stripRules(readFileSync(join(repoRoot, "README.md"), "utf8")), fileName);
}

/** docx と同じ場所・同じ名前の PDF のパス */
export function pdfPathFor(docx: string): string {
  return docx.replace(/\.docx$/, ".pdf");
}

/**
 * docx を LibreOffice で PDF にし、docx と同じ場所に置く。PDF のパスとページ数を返す。
 * Mac の LibreOffice は Windows / Office のフォント名「Yu Gothic」を使えないため、
 * 変換用のコピーだけヒラギノ角ゴシックに置き換える（PDF にはフォントが埋め込まれるので、相手の環境に依存しない）。
 * --headless では Mac のフォントを使えないため、macOS の描画方式で変換する。
 */
export function exportPdf(docx: string): { pdf: string; pages: number } | undefined {
  const work = mkdtempSync(join(tmpdir(), "cv-pdf-"));
  try {
    const copy = join(work, "converted.docx");
    patchDocx(docx, copy, {
      "word/styles.xml": (xml) => xml.replaceAll('"Yu Gothic"', '"Hiragino Sans"'),
    });
    spawnSync("soffice", ["--convert-to", "pdf", "--outdir", work, copy], {
      env: { ...process.env, SAL_USE_VCLPLUGIN: "osx" },
      stdio: "ignore",
    });
    const converted = join(work, "converted.pdf");
    if (!existsSync(converted)) return undefined;
    const pdf = pdfPathFor(docx);
    copyFileSync(converted, pdf);
    return { pdf, pages: countPdfPages(readFileSync(pdf)) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** コマンドの最後に PDF を作って報告する。CV_DOCX_SKIP_PDF=1 なら作らない */
export function reportPdf(docx: string): void {
  if (process.env.CV_DOCX_SKIP_PDF) return;
  if (!hasCommand("soffice")) {
    console.error("LibreOffice（soffice）が見つからないため、PDF は作っていません。");
    return;
  }
  const result = exportPdf(docx);
  if (!result) {
    console.error(`PDF を作れませんでした（${basename(docx)} の変換に失敗。LibreOffice を開いている場合は閉じてから再実行する）。`);
    return;
  }
  console.log(result.pdf);
  console.log(`ページ数（A4、LibreOffice での目安）: ${result.pages}`);
}

if (import.meta.main) {
  if (!hasCommand("pandoc")) {
    console.error("pandoc が見つかりません。");
    process.exit(2);
  }
  const repoRoot = git(dirname(fileURLToPath(import.meta.url)), "rev-parse", "--show-toplevel");
  let out: string;
  try {
    out = buildDocx(repoRoot, process.argv[2]);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(2);
  }
  console.log(out);
  reportPdf(out);
}
