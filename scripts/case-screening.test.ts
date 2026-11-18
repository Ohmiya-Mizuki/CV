import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  applyEdits,
  dropUnverified,
  gmailLink,
  type CaseResult,
  countVerdicts,
  newCases,
  quotedFrom,
  renderNotice,
  renderPrBody,
  renderReport,
  secretWords,
  validateScreening,
  validateTailor,
} from "./case-screening.ts";

const SHEET = "# 案件1\n\n| 役割 | テックリード |\n\nPHPStanに層間の依存違反を検知する独自ルールを追加\n\nTerraformで実行基盤をIaC化\n";
const README = "# 業務経歴書\n\n- 静的解析の独自ルールを追加\n- 画面の実装を担当\n";

function makeCase(overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    threadId: "t1",
    receivedAt: "2026-11-17T09:00:00+09:00",
    source: "架空エージェント",
    company: "架空商事",
    title: "物流向け管理画面の刷新",
    conditions: "月80万円・週4日・リモート",
    summary: "Laravel の管理画面を刷新する",
    verdict: "合う",
    fits: [{ point: "静的解析の独自ルールの経験", quote: "PHPStanに層間の依存違反を検知する独自ルールを追加" }],
    gaps: ["Go の経験が浅い"],
    questions: ["チームの体制"],
    ...overrides,
  };
}

const okEdit = {
  before: "- 静的解析の独自ルールを追加",
  after: "- PHPStan で層間の依存違反を検知する独自ルールを追加",
  reason: "求める静的解析の経験が伝わるよう具体にした",
  quote: "PHPStanに層間の依存違反を検知する独自ルールを追加",
};

describe("quotedFrom", () => {
  test("空白の違いを無視して引用を見つける", () => {
    const actual = quotedFrom(SHEET, "Terraform で 実行基盤を IaC化");
    const expected = true;
    assert.equal(actual, expected);
  });

  test("スキルシートにない文は引用と認めない", () => {
    const actual = quotedFrom(SHEET, "Kubernetes の運用を主導");
    const expected = false;
    assert.equal(actual, expected);
  });
});

describe("validateScreening", () => {
  test("決まった形で根拠がスキルシートにあれば通る", () => {
    const actual = validateScreening({ searched: ["t1"], cases: [makeCase()] }, SHEET);
    const expected: string[] = [];
    assert.deepEqual(actual, expected);
  });

  test("根拠がスキルシートにない合う点を落とす", () => {
    const c = makeCase({ fits: [{ point: "Kubernetes", quote: "Kubernetes の運用を主導" }] });
    const actual = validateScreening({ searched: ["t1"], cases: [c] }, SHEET).length;
    const expected = 1;
    assert.equal(actual, expected);
  });

  test("検索で見つかっていないスレッドを落とす", () => {
    const actual = validateScreening({ searched: [], cases: [makeCase()] }, SHEET).length;
    const expected = 1;
    assert.equal(actual, expected);
  });

  test("見送りでない案件に面談で確かめる事項がなければ落とす", () => {
    const actual = validateScreening({ searched: ["t1"], cases: [makeCase({ questions: [] })] }, SHEET).length;
    const expected = 1;
    assert.equal(actual, expected);
  });

  test("決まった判定でなければ落とす", () => {
    const c = { ...makeCase(), verdict: "たぶん" };
    const actual = validateScreening({ searched: ["t1"], cases: [c] }, SHEET).length;
    const expected = 1;
    assert.equal(actual, expected);
  });

  test("形が違えば1件の問題だけを返す", () => {
    const actual = validateScreening({ threads: [] }, SHEET).length;
    const expected = 1;
    assert.equal(actual, expected);
  });
});

describe("validateScreening の経路", () => {
  test("設定にない経路を落とす", () => {
    const actual = validateScreening({ searched: ["t1"], cases: [makeCase({ channel: "ない経路" })] }, SHEET, ["corporate"]).length;
    const expected = 1;
    assert.equal(actual, expected);
  });
});

describe("gmailLink", () => {
  test("経路のアカウントで開くリンクにする", () => {
    const actual = gmailLink({ freelance: "me@example.com" })(makeCase({ channel: "freelance" }));
    const expected = "https://mail.google.com/mail/?authuser=me%40example.com#all/t1";
    assert.equal(actual, expected);
  });
});

describe("newCases", () => {
  test("知らせ済みのスレッドを外す", () => {
    const result = { searched: ["t1", "t2"], cases: [makeCase(), makeCase({ threadId: "t2" })] };
    const actual = newCases(result, new Set(["t1"])).map((c) => c.threadId);
    const expected = ["t2"];
    assert.deepEqual(actual, expected);
  });
});

describe("countVerdicts", () => {
  test("判定ごとに数える", () => {
    const actual = countVerdicts([makeCase(), makeCase({ verdict: "見送り" }), makeCase({ verdict: "合う" })]);
    const expected = { 合う: 2, 要確認: 0, 見送り: 1 };
    assert.deepEqual(actual, expected);
  });
});

describe("renderNotice", () => {
  test("件数と置き場だけを書き、案件の中身を書かない", () => {
    const notice = renderNotice([makeCase()], "2026-11-18", "Drive「キャリア/案件の選別」");
    const actual = ["架空商事", "架空エージェント", "物流", "80万円"].some((w) => notice.includes(w));
    const expected = false;
    assert.equal(actual, expected);
  });

  test("判定ごとの件数を書く", () => {
    const actual = renderNotice([makeCase()], "2026-11-18", "手元").split("\n")[0];
    const expected = "案件の選別 2026-11-18: 新しい案件 1件（合う 1・要確認 0・見送り 0）";
    assert.equal(actual, expected);
  });
});

describe("renderReport", () => {
  test("合う案件を見送りより先に並べる", () => {
    const report = renderReport(
      [makeCase({ threadId: "a", verdict: "見送り", title: "後" }), makeCase({ threadId: "b", title: "先" })],
      "2026-11-18",
      (c) => `mail:${c.threadId}`,
    );
    const actual = report.indexOf("【合う】先") < report.indexOf("【見送り】後");
    const expected = true;
    assert.equal(actual, expected);
  });

  test("合う点に根拠の引用を添える", () => {
    const report = renderReport([makeCase()], "2026-11-18", (c) => `mail:${c.threadId}`);
    const actual = report.includes("根拠: 「PHPStanに層間の依存違反を検知する独自ルールを追加」");
    const expected = true;
    assert.equal(actual, expected);
  });
});

describe("validateTailor", () => {
  const secrets = secretWords(makeCase());

  test("根拠のある書き換えは通る", () => {
    const actual = validateTailor({ threadId: "t1", focus: "物流業向けの管理画面", edits: [okEdit] }, README, SHEET, secrets);
    const expected: string[] = [];
    assert.deepEqual(actual, expected);
  });

  test("根拠に「主導」がないのに「主導」を足すと落とす", () => {
    const edit = { ...okEdit, after: "- 静的解析の独自ルールの導入を主導" };
    const actual = validateTailor({ threadId: "t1", focus: "管理画面", edits: [edit] }, README, SHEET, secrets).length;
    const expected = 1;
    assert.equal(actual, expected);
  });

  test("コミット数のアピールを落とす", () => {
    const edit = { ...okEdit, after: "- 静的解析の独自ルールを追加（コミット 320 件）" };
    const actual = validateTailor({ threadId: "t1", focus: "管理画面", edits: [edit] }, README, SHEET, secrets).length;
    const expected = 1;
    assert.equal(actual, expected);
  });

  test("根拠の引用がスキルシートにない書き換えを落とす", () => {
    const edit = { ...okEdit, quote: "Kubernetes の運用" };
    const actual = validateTailor({ threadId: "t1", focus: "管理画面", edits: [edit] }, README, SHEET, secrets).length;
    const expected = 1;
    assert.equal(actual, expected);
  });

  test("README.md にない文の書き換えを落とす", () => {
    const edit = { ...okEdit, before: "- ない文" };
    const actual = validateTailor({ threadId: "t1", focus: "管理画面", edits: [edit] }, README, SHEET, secrets).length;
    const expected = 1;
    assert.equal(actual, expected);
  });

  test("公開の文に会社名があれば落とす", () => {
    const actual = validateTailor({ threadId: "t1", focus: "架空商事の管理画面", edits: [okEdit] }, README, SHEET, secrets).length;
    const expected = 1;
    assert.equal(actual, expected);
  });

  test("公開の文に単価の話があれば落とす", () => {
    const edit = { ...okEdit, reason: "単価の高い案件に合わせた" };
    const actual = validateTailor({ threadId: "t1", focus: "管理画面", edits: [edit] }, README, SHEET, secrets).length;
    const expected = 1;
    assert.equal(actual, expected);
  });

  test("作業メモのような文言を落とす", () => {
    const edit = { ...okEdit, after: "- 静的解析の独自ルールを追加（要確認）" };
    const actual = validateTailor({ threadId: "t1", focus: "管理画面", edits: [edit] }, README, SHEET, secrets).length;
    const expected = 1;
    assert.equal(actual, expected);
  });

  test("書き換えが0件なら落とす", () => {
    const actual = validateTailor({ threadId: "t1", focus: "管理画面", edits: [] }, README, SHEET, secrets).length;
    const expected = 1;
    assert.equal(actual, expected);
  });
});

describe("dropUnverified", () => {
  test("根拠の引用がスキルシートにない書き換えだけを外す", () => {
    const input = { threadId: "t1", focus: "管理画面", edits: [okEdit, { ...okEdit, quote: "Kubernetes の運用" }] };
    const actual = dropUnverified(input, SHEET).dropped;
    const expected = 1;
    assert.equal(actual, expected);
  });

  test("全部外れたら、書き換えが0件として検査で落ちる", () => {
    const input = { threadId: "t1", focus: "管理画面", edits: [{ ...okEdit, quote: "Kubernetes の運用" }] };
    const actual = validateTailor(dropUnverified(input, SHEET).input, README, SHEET, []).length;
    const expected = 1;
    assert.equal(actual, expected);
  });
});

describe("applyEdits", () => {
  test("before を after に置き換える", () => {
    const actual = applyEdits(README, [okEdit]);
    const expected = "# 業務経歴書\n\n- PHPStan で層間の依存違反を検知する独自ルールを追加\n- 画面の実装を担当\n";
    assert.equal(actual, expected);
  });

  test("after の $ を置換の記号として扱わない", () => {
    const actual = applyEdits("a\n", [{ ...okEdit, before: "a", after: "$&b" }]);
    const expected = "$&b\n";
    assert.equal(actual, expected);
  });
});

describe("renderPrBody", () => {
  test("変えた理由を並べる", () => {
    const actual = renderPrBody({ threadId: "t1", focus: "物流業向けの管理画面", edits: [okEdit] }).includes(`- ${okEdit.reason}`);
    const expected = true;
    assert.equal(actual, expected);
  });
});
