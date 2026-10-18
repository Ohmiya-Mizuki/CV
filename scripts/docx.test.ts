import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { patchDocx, replaceOnce } from "./docx.ts";
import { tempDir, writeFile } from "./test-helpers.ts";

describe("replaceOnce", () => {
  test("1回だけ一致する箇所を置き換える", () => {
    assert.equal(replaceOnce("<a>1</a><b>2</b>", /<b>\d<\/b>/, "<b>3</b>"), "<a>1</a><b>3</b>");
  });

  test("キャプチャを置き換え文字列で参照できる", () => {
    assert.equal(replaceOnce('<x v="1" />', /(<x )v="\d"/, '$1v="9"'), '<x v="9" />');
  });

  test("一致しないと止まる", () => {
    assert.throws(() => replaceOnce("<a />", /<b \/>/, ""), /雛形の構造が想定と違います/);
  });

  test("2回以上一致すると止まる", () => {
    assert.throws(() => replaceOnce("<a /><a />", /<a \/>/, ""), /雛形の構造が想定と違います/);
  });

  test("g フラグ付きでも1回だけ置き換える", () => {
    assert.equal(replaceOnce("<a />", /<a \/>/g, "<b />"), "<b />");
  });
});

describe("patchDocx", () => {
  function makeDocx(dir: string): string {
    const src = join(dir, "src");
    writeFile(join(src, "[Content_Types].xml"), "<Types />");
    writeFile(join(src, "word", "styles.xml"), "<styles>old</styles>");
    writeFile(join(src, "word", "document.xml"), "<document />");
    const docx = join(dir, "in.docx");
    execFileSync("zip", ["-q", "-X", "-r", docx, "word", "[Content_Types].xml"], { cwd: src });
    return docx;
  }

  const entries = (docx: string): string[] =>
    execFileSync("zipinfo", ["-1", docx], { encoding: "utf8" }).trim().split("\n");

  test("指定したファイルだけを書き換え、元の docx は変えない", () => {
    const dir = tempDir();
    const src = makeDocx(dir);
    const before = readFileSync(src);
    const dst = join(dir, "out.docx");

    patchDocx(src, dst, { "word/styles.xml": (xml) => xml.replace("old", "new") });

    assert.equal(execFileSync("unzip", ["-p", dst, "word/styles.xml"], { encoding: "utf8" }), "<styles>new</styles>");
    assert.equal(execFileSync("unzip", ["-p", dst, "word/document.xml"], { encoding: "utf8" }), "<document />");
    assert.deepEqual(readFileSync(src), before);
  });

  test("[Content_Types].xml を先頭に入れる", () => {
    const dir = tempDir();
    const dst = join(dir, "out.docx");
    patchDocx(makeDocx(dir), dst, {});
    assert.equal(entries(dst)[0], "[Content_Types].xml");
    assert.equal(entries(dst).filter((e) => e === "[Content_Types].xml").length, 1);
  });

  test("出力先に既存のファイルがあれば置き換える（古い中身を残さない）", () => {
    const dir = tempDir();
    const dst = join(dir, "out.docx");
    writeFile(join(dir, "stale", "stale.xml"), "<stale />");
    execFileSync("zip", ["-q", "-r", dst, "stale"], { cwd: dir });

    patchDocx(makeDocx(dir), dst, {});

    assert.ok(!entries(dst).some((e) => e.startsWith("stale")));
  });
});
