import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  dropPlaceholderRows,
  excludeProjects,
  parseExcludedNames,
  recountProcesses,
  widenTableColumns,
} from "./skill-sheet.ts";
import { SHEET } from "./test-helpers.ts";


const caseNames = (md: string): string[] => [...md.matchAll(/^\| 案件名 \| (.*?) \|$/gm)].map((m) => m[1]);
const headings = (md: string): string[] => [...md.matchAll(/^# 案件\d+$/gm)].map((m) => m[0]);

describe("parseExcludedNames", () => {
  test("表の 1 列目（見出しと区切りを除く）を返す", () => {
    const md = "# 一覧\n\n| 案件名 | 期間 |\n| --- | --- |\n| A | 2025 |\n| B | 2026 |\n";
    assert.deepEqual(parseExcludedNames(md), ["A", "B"]);
  });

  test("表がなければ空", () => {
    assert.deepEqual(parseExcludedNames("# 一覧\n\nなし\n"), []);
  });
});

describe("excludeProjects", () => {
  test("指定した案件の節を外し、残りを 1 から振り直す", () => {
    const { markdown, excluded, notFound } = excludeProjects(SHEET, ["載せない案件"]);
    assert.deepEqual(caseNames(markdown), ["新しい案件", "古い案件"]);
    assert.deepEqual(headings(markdown), ["# 案件1", "# 案件2"]);
    assert.deepEqual(excluded, ["載せない案件"]);
    assert.deepEqual(notFound, []);
  });

  test("案件より前の部分（基本情報・工程の表）はそのまま残す", () => {
    const { markdown } = excludeProjects(SHEET, ["載せない案件"]);
    assert.ok(markdown.startsWith(SHEET.slice(0, SHEET.indexOf("# 案件1"))));
  });

  test("スキルシートにない案件名は notFound に返し、何も外さない", () => {
    const { markdown, notFound } = excludeProjects(SHEET, ["存在しない案件"]);
    assert.equal(markdown, SHEET);
    assert.deepEqual(notFound, ["存在しない案件"]);
  });

  test("名前の一部が一致するだけでは外さない", () => {
    const { excluded } = excludeProjects(SHEET, ["案件"]);
    assert.deepEqual(excluded, []);
  });
});

describe("recountProcesses", () => {
  test("各案件の担当工程から経験件数を数え直し、変わった工程を返す", () => {
    const { markdown, changes } = recountProcesses(SHEET);
    assert.match(markdown, /^\| 要件定義 \| 有 \| 1件 \| B \|$/m);
    assert.match(markdown, /^\| 実装 \| 有 \| 3件 \| A \|$/m);
    assert.match(markdown, /^\| 総合テスト \| 有 \| 1件 \| B \|$/m);
    assert.deepEqual(changes, [
      { process: "要件定義", before: "有・9件", after: "有・1件" },
      { process: "実装", before: "有・9件", after: "有・3件" },
    ]);
  });

  test("案件を外したあとに数え直すと、外した案件の工程は数えない", () => {
    const { markdown } = recountProcesses(excludeProjects(SHEET, ["載せない案件"]).markdown);
    assert.match(markdown, /^\| 実装 \| 有 \| 2件 \| A \|$/m);
  });

  test("どの案件にもない工程は「無・0件」にし、習熟度は変えない", () => {
    const { markdown } = recountProcesses(excludeProjects(SHEET, ["古い案件"]).markdown);
    assert.match(markdown, /^\| 総合テスト \| 無 \| 0件 \| B \|$/m);
  });

  test("工程の表の外は変えない", () => {
    const { markdown } = recountProcesses(SHEET);
    assert.equal(markdown.slice(markdown.indexOf("## 保有資格")), SHEET.slice(SHEET.indexOf("## 保有資格")));
  });
});

describe("dropPlaceholderRows", () => {
  test("【要記入】を含む表の行だけを外す", () => {
    const out = dropPlaceholderRows(SHEET);
    assert.doesNotMatch(out, /【要記入】/);
    assert.match(out, /^\| 担当工程 \| 要件定義、実装 \|$/m);
  });

  test("表の外の【要記入】は残す", () => {
    assert.equal(dropPlaceholderRows("本文の【要記入】\n"), "本文の【要記入】\n");
  });
});

describe("widenTableColumns", () => {
  test("2 列の表は 1 列目を狭く、2 列目を広くする", () => {
    assert.equal(widenTableColumns("| 項目 | 内容 |\n| --- | --- |"), "| 項目 | 内容 |\n| ------ | ------------------------------ |");
  });

  test("4 列の表は見出しで幅の配分を変える", () => {
    const [, recent] = widenTableColumns("| 言語 | 経験年数 | 習熟度 | 直近の使用時期 |\n| --- | --- | --- | --- |").split("\n");
    const [, usage] = widenTableColumns("| 名称 | 経験年数 | 習熟度 | 主な用途 |\n| --- | --- | --- | --- |").split("\n");
    assert.ok(recent.split("|")[1].length > recent.split("|")[4].length);
    assert.ok(usage.split("|")[4].length > usage.split("|")[1].length);
  });

  test("区切り行以外と、すでに幅を指定した区切り行は変えない", () => {
    const md = "| --- 本文 |\n| -------- | -- |";
    assert.equal(widenTableColumns(md), md);
  });
});
