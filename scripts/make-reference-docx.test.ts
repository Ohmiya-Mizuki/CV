import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildReference, patchDocument, patchStyles } from "./make-reference-docx.ts";
import { hasCommand, tempDir } from "./test-helpers.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const unzipText = (docx: string, path: string): string =>
  execFileSync("unzip", ["-p", docx, path], { encoding: "utf8" });
const styleBlock = (xml: string, id: string): string =>
  xml.match(new RegExp(`<w:style [^>]*w:styleId="${id}"[\\s\\S]*?</w:style>`))?.[0] ?? "";

// pandoc 既定の雛形と同じ構造を持つ最小の styles.xml
const STYLES = `<w:styles>
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:hAnsiTheme="minorHAnsi" w:cstheme="minorBidi" />
      <w:sz w:val="24" />
      <w:szCs w:val="24" />
      <w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA" />
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="200" /></w:pPr></w:pPrDefault>
  </w:docDefaults>
  ${["BodyText", "Compact", "Heading1", "Heading2", "Heading3", "Heading4", "Title"]
    .map(
      (id) =>
        `<w:style w:type="paragraph" w:styleId="${id}"><w:pPr><w:spacing w:before="180" w:after="180" /></w:pPr>` +
        `<w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia" /><w:sz w:val="40" /><w:szCs w:val="40" /></w:rPr></w:style>`,
    )
    .join("\n  ")}
</w:styles>`;

describe("patchStyles", () => {
  const xml = patchStyles(STYLES);

  test("本文を游ゴシック 9.5pt・日本語にする", () => {
    const defaults = xml.match(/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/)?.[0] ?? "";
    assert.match(defaults, /<w:rFonts w:ascii="Yu Gothic" w:hAnsi="Yu Gothic" w:eastAsia="Yu Gothic" w:cs="Yu Gothic" \/>/);
    assert.match(defaults, /<w:sz w:val="19" \/><w:szCs w:val="19" \/>/);
    assert.match(defaults, /w:eastAsia="ja-JP"/);
  });

  test("見出しのフォントもテーマから游ゴシックに固定する", () => {
    assert.doesNotMatch(xml, /majorHAnsi/);
    assert.match(styleBlock(xml, "Heading1"), /w:ascii="Yu Gothic"/);
  });

  test("見出しの大きさを設定し、元の大きさを残さない", () => {
    const heading1 = styleBlock(xml, "Heading1");
    assert.match(heading1, /<w:sz w:val="30" \/>/);
    assert.doesNotMatch(heading1, /<w:sz w:val="40" \/>/);
    assert.equal(heading1.match(/<w:sz /g)?.length, 1);
  });

  test("段落の間隔を詰める", () => {
    assert.match(styleBlock(xml, "BodyText"), /<w:spacing w:before="0" w:after="100" \/>/);
    assert.match(styleBlock(xml, "Compact"), /<w:spacing w:before="0" w:after="0" \/>/);
    assert.match(xml, /<w:pPrDefault>[\s\S]*<w:spacing w:after="80" w:line="240" w:lineRule="auto" \/>/);
  });

  test("想定と違う構造なら止まる", () => {
    assert.throws(() => patchStyles("<w:styles />"), /雛形の構造が想定と違います/);
  });
});

describe("patchDocument", () => {
  test("用紙を A4・余白 15mm にする", () => {
    const xml = patchDocument("<w:body><w:p /><w:sectPr><w:footnotePr /></w:sectPr></w:body>");
    assert.match(xml, /<w:pgSz w:w="11906" w:h="16838" \/>/);
    assert.match(xml, /<w:pgMar w:top="851" w:right="851" w:bottom="851" w:left="851"/);
    assert.equal(xml.match(/<w:sectPr>/g)?.length, 1);
  });
});

describe("buildReference", { skip: !hasCommand("pandoc") && "pandoc がない" }, () => {
  test("pandoc 既定の雛形から作れる", () => {
    const out = join(tempDir(), "reference.docx");
    buildReference(out);
    assert.match(unzipText(out, "word/styles.xml"), /w:eastAsia="Yu Gothic"/);
    assert.match(unzipText(out, "word/document.xml"), /<w:pgSz w:w="11906"/);
  });

  test("コミットされている templates/reference.docx が最新のスクリプトの出力と一致する", () => {
    const out = join(tempDir(), "reference.docx");
    buildReference(out);
    const committed = join(root, "templates", "reference.docx");
    for (const path of ["word/styles.xml", "word/document.xml"]) {
      assert.equal(
        unzipText(committed, path),
        unzipText(out, path),
        `${path} が古い。node scripts/make-reference-docx.ts を実行してコミットする`,
      );
    }
  });
});
