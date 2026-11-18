// 届いた受託案件の選別と、選んだ案件に合わせた経歴書の書き換え案を、検査して形にする（AIを使わない部分）。
//
// AI（ヘッドレスの Claude Code）は、メールを読んで結果の JSON を書くだけ。ここでは、
// - 選別の結果が決まった形か、合う点の根拠がスキルシート（事実の正本）に本当にあるかを確かめる
// - 本人だけが見る報告（案件の中身つき）と、外に出す知らせ（件数だけ）を分けて組み立てる
// - 経歴書の書き換え案が、事実を盛っていないか・案件の中身を漏らしていないかを確かめ、README.md に当てる
// を行う。使い方は case-screening/README.md。
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { findDraftNotes } from "./draft-notes.ts";

export const VERDICTS = ["合う", "要確認", "見送り"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** 合う点。quote はスキルシートからの引用（そのまま含まれていること） */
export type Fit = { point: string; quote: string };

export type CaseResult = {
  threadId: string;
  channel?: string; // 届いた経路の名前（設定の sources の name）。本人だけが見る
  receivedAt: string;
  source: string; // 紹介元（サービス名・紹介会社名）。本人だけが見る
  company: string; // 案件の会社名（分からなければ空）。本人だけが見る
  title: string; // 案件名。本人だけが見る
  conditions: string; // 単価・期間・稼働・場所など、本文から抜き出した条件。本人だけが見る
  summary: string; // 案件の中身の要約。本人だけが見る
  verdict: Verdict;
  fits: Fit[];
  gaps: string[];
  questions: string[];
};

/** selected は、本人が選んだ印のラベルを付けたスレッド（経歴書の案を作る対象） */
export type ScreeningResult = { searched: string[]; cases: CaseResult[]; selected?: string[] };

export type Counts = Record<Verdict, number>;

const normalize = (s: string): string => s.replace(/\s+/g, "").replace(/[（]/g, "(").replace(/[）]/g, ")");

/** スキルシートに、引用がそのまま含まれるか（空白と全角かっこの違いは見ない） */
export function quotedFrom(sheet: string, quote: string): boolean {
  const q = normalize(quote);
  return q.length >= 4 && normalize(sheet).includes(q);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** 選別の結果を検査し、見つけた問題を返す（空なら通る） */
export function validateScreening(input: unknown, sheet: string, channels: string[] = []): string[] {
  if (!isObject(input) || !isStringArray(input.searched) || !Array.isArray(input.cases)) {
    return ["結果は {searched: string[], cases: []} の形にする"];
  }
  const errors: string[] = [];
  if (input.selected !== undefined && !isStringArray(input.selected)) errors.push("selected: 文字列の配列でない");
  const searched = new Set(input.searched);
  const seen = new Set<string>();
  input.cases.forEach((c: unknown, i: number) => {
    const at = `cases[${i}]`;
    if (!isObject(c)) {
      errors.push(`${at}: オブジェクトでない`);
      return;
    }
    for (const key of ["threadId", "receivedAt", "source", "company", "title", "conditions", "summary"]) {
      if (typeof c[key] !== "string") errors.push(`${at}.${key}: 文字列でない`);
    }
    if (c.channel !== undefined && (typeof c.channel !== "string" || (channels.length > 0 && !channels.includes(c.channel)))) {
      errors.push(`${at}.channel: 設定にない経路`);
    }
    const id = String(c.threadId);
    if (!searched.has(id)) errors.push(`${at}: 検索で見つかっていないスレッド ${id}`);
    if (seen.has(id)) errors.push(`${at}: 同じスレッドが2回ある ${id}`);
    seen.add(id);
    if (!VERDICTS.includes(c.verdict as Verdict)) errors.push(`${at}.verdict: ${VERDICTS.join("・")}のどれでもない`);
    if (!isStringArray(c.gaps)) errors.push(`${at}.gaps: 文字列の配列でない`);
    if (!isStringArray(c.questions)) errors.push(`${at}.questions: 文字列の配列でない`);
    else if (c.verdict !== "見送り" && c.questions.length === 0) errors.push(`${at}.questions: 面談で確かめる事項がない`);
    if (!Array.isArray(c.fits)) {
      errors.push(`${at}.fits: 配列でない`);
      return;
    }
    if (c.verdict === "合う" && c.fits.length === 0) errors.push(`${at}.fits: 「合う」なのに合う点がない`);
    c.fits.forEach((f: unknown, j: number) => {
      if (!isObject(f) || typeof f.point !== "string" || typeof f.quote !== "string") {
        errors.push(`${at}.fits[${j}]: {point, quote} の形でない`);
      } else if (!quotedFrom(sheet, f.quote)) {
        errors.push(`${at}.fits[${j}]: 根拠の引用がスキルシートにない「${f.quote.slice(0, 40)}」`);
      }
    });
  });
  return errors;
}

/** まだ知らせていない案件だけを返す */
export function newCases(result: ScreeningResult, seenIds: Set<string>): CaseResult[] {
  return result.cases.filter((c) => !seenIds.has(c.threadId));
}

export function countVerdicts(cases: CaseResult[]): Counts {
  const counts: Counts = { 合う: 0, 要確認: 0, 見送り: 0 };
  for (const c of cases) counts[c.verdict] += 1;
  return counts;
}

const ORDER: Record<Verdict, number> = { 合う: 0, 要確認: 1, 見送り: 2 };

/** 本人だけが見る報告（案件の中身つき）。Mac mini の手元（reports/）に置く */
export function renderReport(cases: CaseResult[], date: string, gmailLink: (c: CaseResult) => string): string {
  const counts = countVerdicts(cases);
  const lines = [
    `# 案件の選別 ${date}`,
    "",
    `新しい案件 ${cases.length}件（合う ${counts.合う}・要確認 ${counts.要確認}・見送り ${counts.見送り}）。`,
    "合う点の根拠は、スキルシート（事実の正本）からの引用。応募・返信はしていない。",
    "経歴書の書き換え案がほしい案件は、メールに選んだ印のラベルを付ける（次の回に下書きの PR ができる）。",
    "",
  ];
  const sorted = [...cases].sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || a.receivedAt.localeCompare(b.receivedAt));
  for (const c of sorted) {
    lines.push(`## 【${c.verdict}】${c.title || "（案件名なし）"}`, "");
    lines.push(`- 紹介元: ${c.source}${c.company ? `／会社: ${c.company}` : ""}${c.channel ? `（経路: ${c.channel}）` : ""}`);
    lines.push(`- 条件: ${c.conditions || "（書かれていない）"}`);
    lines.push(`- 受信: ${c.receivedAt}／[メール](${gmailLink(c)})`);
    lines.push(`- 中身: ${c.summary}`, "");
    lines.push("**合う点**", "");
    if (c.fits.length === 0) lines.push("- （なし）");
    for (const f of c.fits) lines.push(`- ${f.point}`, `  - 根拠: 「${f.quote}」`);
    lines.push("", "**足りない点**", "");
    if (c.gaps.length === 0) lines.push("- （なし）");
    for (const g of c.gaps) lines.push(`- ${g}`);
    lines.push("", "**面談で確かめる事項**", "");
    if (c.questions.length === 0) lines.push("- （なし）");
    for (const q of c.questions) lines.push(`- ${q}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** 外に出す知らせ（件数だけ。案件の本文・単価・会社名は載せない） */
export function renderNotice(cases: CaseResult[], date: string, reportPlace: string): string {
  const counts = countVerdicts(cases);
  return [
    `案件の選別 ${date}: 新しい案件 ${cases.length}件（合う ${counts.合う}・要確認 ${counts.要確認}・見送り ${counts.見送り}）`,
    `中身は ${reportPlace} に置いた（応募・返信はしていない）`,
  ].join("\n");
}

// ---- 経歴書の書き換え案 ----

/** before は README.md にちょうど1回ある文、after は書き換え後、quote はスキルシートからの根拠 */
export type Edit = { before: string; after: string; reason: string; quote: string };
/** focus は案件の分野を「業種＋用途」で書いたもの（公開の PR に載る） */
export type TailorResult = { threadId: string; focus: string; edits: Edit[] };

const COMMIT_COUNT = /コミット(数|\s*[0-9０-９,，]+\s*(件|本|回|個))|[0-9,]+\s*commits?\b/i;
const URL_OR_MAIL = /https?:\/\/|[\w.+-]+@[\w-]+\.[\w.]+/;
const MONEY = /単価|[0-9０-９]+\s*万円|月額|時給/;

const occurrences = (text: string, part: string): number => (part === "" ? 0 : text.split(part).length - 1);

/** 公開の PR に出してはいけない語（案件の会社名・紹介元・案件名のうち2文字以上のもの） */
export function secretWords(c: Pick<CaseResult, "company" | "source" | "title">): string[] {
  return [c.company, c.source, c.title].map((s) => s.trim()).filter((s) => s.length >= 2);
}

/** 経歴書の書き換え案を検査し、見つけた問題を返す（空なら通る） */
export function validateTailor(input: unknown, readme: string, sheet: string, secrets: string[]): string[] {
  if (!isObject(input) || typeof input.focus !== "string" || !Array.isArray(input.edits)) {
    return ["書き換え案は {threadId, focus, edits: []} の形にする"];
  }
  const errors: string[] = [];
  const publicTexts: [string, string][] = [["focus", input.focus]];
  if (input.edits.length === 0 || input.edits.length > 8) errors.push("edits は1〜8件にする");
  input.edits.forEach((e: unknown, i: number) => {
    const at = `edits[${i}]`;
    if (!isObject(e) || !["before", "after", "reason", "quote"].every((k) => typeof e[k] === "string")) {
      errors.push(`${at}: {before, after, reason, quote} の形でない`);
      return;
    }
    const { before, after, reason, quote } = e as Edit;
    publicTexts.push([`${at}.after`, after], [`${at}.reason`, reason]);
    if (occurrences(readme, before) !== 1) errors.push(`${at}.before: README.md にちょうど1回ある文でない`);
    if (before === after) errors.push(`${at}: 書き換えていない`);
    if (!quotedFrom(sheet, quote)) errors.push(`${at}.quote: 根拠の引用がスキルシートにない`);
    if (occurrences(after, "主導") > occurrences(before, "主導") && !quote.includes("主導")) {
      errors.push(`${at}: 「主導」を足しているが、根拠に「主導」がない（実際にリードしたときだけ書く）`);
    }
    if (COMMIT_COUNT.test(after)) errors.push(`${at}: コミット数をアピールに使っている`);
    if (findDraftNotes(after).length > 0) errors.push(`${at}: 作業メモのような文言がある`);
  });
  for (const [where, text] of publicTexts) {
    if (URL_OR_MAIL.test(text)) errors.push(`${where}: URL かメールアドレスがある`);
    if (MONEY.test(text)) errors.push(`${where}: 単価・金額の話がある`);
    for (const w of secrets) if (text.includes(w)) errors.push(`${where}: 案件を見分けられる語がある`);
  }
  return errors;
}

/**
 * 根拠の引用がスキルシートにない書き換えを外す（AI が句読点を言い換えただけでも外す。事実を確かめられないため）。
 * 外したあとに残ったものだけを検査に回す。漏えい・「主導」・コミット数などの違反は、外さずに回ごと止める
 */
export function dropUnverified(input: unknown, sheet: string): { input: unknown; dropped: number } {
  if (!isObject(input) || !Array.isArray(input.edits)) return { input, dropped: 0 };
  const kept = input.edits.filter((e: unknown) => !isObject(e) || typeof e.quote !== "string" || quotedFrom(sheet, e.quote));
  return { input: { ...input, edits: kept }, dropped: input.edits.length - kept.length };
}

/** README.md に書き換えを当てる（検査を通したものだけを渡す） */
export function applyEdits(readme: string, edits: Edit[]): string {
  return edits.reduce((text, e) => text.replace(e.before, () => e.after), readme);
}

/** 下書きの PR の本文（公開。案件の中身を書かない） */
export function renderPrBody(t: TailorResult, dropped = 0): string {
  return [
    `選んだ案件（${t.focus}）に合わせた、業務経歴書の書き方の案。応募・送付はしていない。`,
    "",
    "## 変えたところ",
    "",
    ...t.edits.map((e) => `- ${e.reason}`),
    "",
    "## 確かめたこと（スクリプトの検査）",
    "",
    "- 書き換えごとに、根拠をスキルシート（事実の正本）から引用し、そのまま含まれることを確かめた",
    "- 根拠のない「主導」、コミット数のアピール、作業メモのような文言がない",
    "- 案件の会社名・紹介元・案件名・単価・URL を書いていない",
    ...(dropped > 0 ? [`- 根拠の引用をスキルシートで確かめられなかった書き換え ${dropped}件は外した`] : []),
    "",
    "マージは本人が決める。合わなければ閉じてよい。",
  ].join("\n");
}

// ---- コマンド ----

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(errors: string[]): never {
  for (const e of errors) process.stderr.write(`${e}\n`);
  process.exit(1);
}

function arg(args: string[], name: string): string {
  const i = args.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= args.length) fail([`--${name} がない`]);
  return args[i + 1];
}

/** 経路ごとのアカウントで開くメールのリンク（報告は本人だけが見る） */
export function gmailLink(accounts: Record<string, string>): (c: CaseResult) => string {
  return (c) => {
    const account = c.channel ? accounts[c.channel] : undefined;
    return `https://mail.google.com/mail/${account ? `?authuser=${encodeURIComponent(account)}` : ""}#all/${c.threadId}`;
  };
}

/**
 * screen: 選別の結果を検査し、新しい案件の報告と知らせを書く。標準出力は {"new":件数, ...} の JSON
 * tailor: 書き換え案を検査し、README.md に当て、PR の本文を書く
 */
export function main(argv: string[]): void {
  const [command, ...args] = argv;
  if (command === "screen") {
    const result = readJson(arg(args, "result"));
    const sheet = readFileSync(arg(args, "skill-sheet"), "utf8");
    const accounts = JSON.parse(arg(args, "accounts")) as Record<string, string>;
    const errors = validateScreening(result, sheet, Object.keys(accounts));
    if (errors.length > 0) fail(errors);
    const seenText = (() => {
      try {
        return readFileSync(arg(args, "seen"), "utf8");
      } catch {
        return "";
      }
    })();
    const seenIds = new Set(seenText.split("\n").filter(Boolean));
    const cases = newCases(result as ScreeningResult, seenIds);
    const date = arg(args, "date");
    writeFileSync(arg(args, "report"), renderReport(cases, date, gmailLink(accounts)));
    writeFileSync(arg(args, "notice"), renderNotice(cases, date, arg(args, "report-place")));
    writeFileSync(arg(args, "cases"), `${JSON.stringify(cases, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ new: cases.length, ...countVerdicts(cases) })}\n`);
    return;
  }
  if (command === "tailor") {
    const input = readJson(arg(args, "edits"));
    const readmePath = arg(args, "readme");
    const readme = readFileSync(readmePath, "utf8");
    const sheet = readFileSync(arg(args, "skill-sheet"), "utf8");
    const caseRecord = readJson(arg(args, "case")) as CaseResult;
    const { input: kept, dropped } = dropUnverified(input, sheet);
    const errors = validateTailor(kept, readme, sheet, secretWords(caseRecord));
    if (errors.length > 0) fail(errors);
    const t = kept as TailorResult;
    writeFileSync(readmePath, applyEdits(readme, t.edits));
    writeFileSync(arg(args, "pr-body"), `${renderPrBody(t, dropped)}\n`);
    process.stdout.write(`${JSON.stringify({ edits: t.edits.length, dropped })}\n`);
    return;
  }
  fail(["使い方: case-screening.ts screen|tailor …（case-screening/README.md）"]);
}

// シンボリックリンク（配置の current）から起動しても動くよう、実パスで比べる
const invoked = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : "";
if (import.meta.url === invoked) main(process.argv.slice(2));
