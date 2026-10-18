// .docx（zip）の中の XML を書き換える共通処理。依存パッケージを増やさないため、
// 展開と圧縮は macOS 標準の unzip / zip コマンドで行う。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type XmlPatches = Record<string, (xml: string) => string>;

/** src の docx を展開し、patches のファイルを書き換えて dst に保存する */
export function patchDocx(src: string, dst: string, patches: XmlPatches): void {
  const work = mkdtempSync(join(tmpdir(), "docx-"));
  try {
    execFileSync("unzip", ["-q", resolve(src), "-d", work]);
    for (const [path, patch] of Object.entries(patches)) {
      const file = join(work, path);
      writeFileSync(file, patch(readFileSync(file, "utf8")));
    }
    rmSync(dst, { force: true });
    // [Content_Types].xml を先頭に入れてから残りを追加する（Word が読む順序に合わせる）
    execFileSync("zip", ["-q", "-X", resolve(dst), "[Content_Types].xml"], { cwd: work });
    execFileSync("zip", ["-q", "-X", "-r", resolve(dst), ".", "-x", "[Content_Types].xml"], { cwd: work });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** pattern に1回だけ一致することを確かめて置き換える。雛形の構造が変わったら止める */
export function replaceOnce(xml: string, pattern: RegExp, replacement: string): string {
  const flags = pattern.flags.replace("g", "");
  const matches = xml.match(new RegExp(pattern.source, `${flags}g`));
  if (matches?.length !== 1) {
    throw new Error(`雛形の構造が想定と違います: ${pattern}`);
  }
  return xml.replace(new RegExp(pattern.source, flags), replacement);
}
