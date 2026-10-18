// 提出用 Word の見た目を決める雛形（templates/reference.docx）を作る。
// pandoc 既定の雛形を元に、A4・余白 15mm・游ゴシック 9.5pt・日本語の言語設定に変え、段落の間隔を詰める。
// 見た目を変えたいときはこのスクリプトを直して再実行し、生成物もコミットする。
//   使い方: node scripts/make-reference-docx.ts
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { patchDocx, replaceOnce } from "./docx.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "templates", "reference.docx");

const FONT = "Yu Gothic"; // Windows / macOS の Word に標準で入っている游ゴシック
const BODY_HALF_POINTS = 19; // 9.5pt
const HEADING_HALF_POINTS: Record<string, number> = {
  Title: 32,
  Heading1: 30,
  Heading2: 26,
  Heading3: 23,
  Heading4: 21,
};
// 段落の前後の間隔（twip）。A4 5 枚に収めるため、pandoc 既定より詰める
const SPACING: Record<string, [before: number, after: number]> = {
  BodyText: [0, 100],
  Compact: [0, 0],
  Heading1: [240, 60],
  Heading2: [200, 60],
  Heading3: [160, 40],
  Heading4: [80, 20],
};
// A4（twip）と余白 15mm
const SECT_PR =
  "<w:sectPr>" +
  '<w:footnotePr><w:numRestart w:val="eachSect" /></w:footnotePr>' +
  '<w:pgSz w:w="11906" w:h="16838" />' +
  '<w:pgMar w:top="851" w:right="851" w:bottom="851" w:left="851" w:header="567" w:footer="567" w:gutter="0" />' +
  "</w:sectPr>";

export function patchStyles(xml: string): string {
  const fonts = `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}" />`;
  xml = replaceOnce(xml, /(<w:rPrDefault>[\s\S]*?)<w:rFonts [^>]*\/>/, `$1${fonts}`);
  xml = replaceOnce(
    xml,
    /(<w:rPrDefault>[\s\S]*?)<w:sz w:val="\d+" \/>\s*<w:szCs w:val="\d+" \/>/,
    `$1<w:sz w:val="${BODY_HALF_POINTS}" /><w:szCs w:val="${BODY_HALF_POINTS}" />`,
  );
  xml = replaceOnce(xml, /(<w:rPrDefault>[\s\S]*?<w:lang [^>]*?)w:eastAsia="[^"]*"/, '$1w:eastAsia="ja-JP"');
  xml = replaceOnce(
    xml,
    /(<w:pPrDefault>[\s\S]*?)<w:spacing w:after="\d+" \/>/,
    '$1<w:spacing w:after="80" w:line="240" w:lineRule="auto" />',
  );
  for (const [styleId, [before, after]] of Object.entries(SPACING)) {
    xml = replaceOnce(
      xml,
      new RegExp(`(<w:style [^>]*w:styleId="${styleId}"[\\s\\S]*?)<w:spacing w:before="\\d+" w:after="\\d+" />`),
      `$1<w:spacing w:before="${before}" w:after="${after}" />`,
    );
  }
  // 見出しのフォントもテーマから游ゴシックに固定する
  xml = xml.replaceAll(/<w:rFonts w:asciiTheme="majorHAnsi"[^>]*\/>/g, fonts);
  for (const [styleId, size] of Object.entries(HEADING_HALF_POINTS)) {
    const style = `(<w:style [^>]*w:styleId="${styleId}"[\\s\\S]*?)`;
    xml = xml.replace(new RegExp(`${style}<w:sz w:val="\\d+" />(\\s*<w:szCs w:val="\\d+" />)?`), "$1");
    xml = replaceOnce(xml, new RegExp(`${style}(</w:rPr>)`), `$1<w:sz w:val="${size}" /><w:szCs w:val="${size}" />$2`);
  }
  return xml;
}

export function patchDocument(xml: string): string {
  return replaceOnce(xml, /<w:sectPr>[\s\S]*?<\/w:sectPr>/, SECT_PR);
}

/** pandoc 既定の雛形を元に、out へ雛形を書き出す */
export function buildReference(dest: string = out): void {
  const work = mkdtempSync(join(tmpdir(), "reference-"));
  try {
    const base = join(work, "default.docx");
    execFileSync("pandoc", ["-o", base, "--print-default-data-file", "reference.docx"]);
    mkdirSync(dirname(dest), { recursive: true });
    patchDocx(base, dest, { "word/styles.xml": patchStyles, "word/document.xml": patchDocument });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  buildReference();
  console.log(relative(root, out));
}
