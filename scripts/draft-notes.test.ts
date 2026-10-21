import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findDraftNotes } from "./draft-notes.ts";

describe("findDraftNotes", () => {
  test("作業メモのような文言を含む行を、行番号付きで返す", () => {
    const md = "# 経歴\n\n| 業界 | 【要記入】 |\n本文。\n2026 年 10 月時点の担当（いずれもレビュー中・実装中）。\n";
    assert.deepEqual(
      findDraftNotes(md).map((n) => n.line),
      [3, 5],
    );
  });

  test("確認待ちや TODO も見つける", () => {
    for (const text of ["本番の環境は確認できない", "要確認", "TODO: 書く", "検討中"]) {
      assert.equal(findDraftNotes(text).length, 1, text);
    }
  });

  test("ふつうの文章は見つけない", () => {
    const md = "## 職務経歴\n\n- テスト実行を約 3 倍高速化\n- 設計・実装・レビューを担当\n- 動作確認を自動化\n";
    assert.deepEqual(findDraftNotes(md), []);
  });

  test("TODO は作業メモとして書かれたときだけ見つける", () => {
    assert.equal(findDraftNotes("TODO: 書く").length, 1);
    assert.equal(findDraftNotes("- TODO 書く").length, 1);
    assert.equal(findDraftNotes("TBD：決める").length, 1);
    assert.deepEqual(findDraftNotes("TODOist というアプリ"), []);
    assert.deepEqual(findDraftNotes("会議エージェント（アジェンダ・議事録・TODO）を実装"), []);
  });
});
