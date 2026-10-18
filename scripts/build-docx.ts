// README.md（業務経歴書の正本）から提出用の Word を作る。
// 出力は本体のチェックアウトの .local/cv/（gitignore済み）。LibreOffice があれば PDF に変換してページ数も表示する。
//   使い方: node scripts/build-docx.ts [出力ファイル名]
//   CV_DOCX_KEEP_PREVIEW=1 で確認用の PDF を残し、CV_DOCX_SKIP_PREVIEW=1 でページ数の確認を飛ばす
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { patchDocx } from "./docx.ts";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

const hasCommand = (name: string): boolean => spawnSync("sh", ["-c", `command -v ${name}`]).status === 0;

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

export function defaultFileName(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `業務経歴書_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.docx`;
}

/** README.md から docx を作り、出力先のパスを返す */
export function buildDocx(repoRoot: string, fileName: string = defaultFileName()): string {
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
    { input: stripRules(readFileSync(join(repoRoot, "README.md"), "utf8")) },
  );
  return out;
}

/**
 * ページ数の目安を LibreOffice で数える。
 * Mac の LibreOffice は Windows / Office のフォント名「Yu Gothic」を使えないため、
 * 確認用のコピーだけ文字幅の近いヒラギノ角ゴシックに置き換える。
 * --headless では Mac のフォントを使えないため、macOS の描画方式で変換する。
 */
export function previewPages(docx: string, keepPdf: boolean): { pages: number; pdf?: string } | undefined {
  const work = mkdtempSync(join(tmpdir(), "cv-preview-"));
  try {
    const preview = join(work, "preview.docx");
    patchDocx(docx, preview, {
      "word/styles.xml": (xml) => xml.replaceAll('"Yu Gothic"', '"Hiragino Sans"'),
    });
    spawnSync("soffice", ["--convert-to", "pdf", "--outdir", work, preview], {
      env: { ...process.env, SAL_USE_VCLPLUGIN: "osx" },
      stdio: "ignore",
    });
    const pdf = join(work, "preview.pdf");
    if (!existsSync(pdf)) return undefined;
    const pages = countPdfPages(readFileSync(pdf));
    if (!keepPdf) return { pages };
    const kept = docx.replace(/\.docx$/, ".preview.pdf");
    copyFileSync(pdf, kept);
    return { pages, pdf: kept };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
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
  if (!process.env.CV_DOCX_SKIP_PREVIEW && hasCommand("soffice")) {
    const result = previewPages(out, Boolean(process.env.CV_DOCX_KEEP_PREVIEW));
    if (result) {
      console.log(`ページ数（A4、LibreOffice での目安）: ${result.pages}`);
      if (result.pdf) console.log(result.pdf);
    } else {
      console.log(`ページ数を数えられませんでした（${basename(out)} の PDF 変換に失敗）。`);
    }
  }
}
