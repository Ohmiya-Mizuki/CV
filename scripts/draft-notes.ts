// 提出物（Word・PDF）に載るべきでない、作業メモのような文言を見つける。
// 見つけても止めずに警告するだけにする（言い回しの判断は本人が行うため）。

/** 作業メモのような文言。空欄の印、確認待ち、進み具合の注記など */
export const DRAFT_NOTE_PATTERNS: RegExp[] = [
  /【要記入】|要記入/,
  /要確認|未確認|確認できない|確認待ち/,
  /レビュー中|実装中|対応中|検討中/,
  /\bTODO\b|\bTBD\b|\bFIXME\b/,
];

export type DraftNote = { line: number; text: string };

/** Markdown のうち、作業メモのような文言を含む行を返す（行番号は 1 から） */
export function findDraftNotes(markdown: string): DraftNote[] {
  return markdown
    .split("\n")
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => DRAFT_NOTE_PATTERNS.some((pattern) => pattern.test(text)));
}

/** 見つかった行を警告として表示する */
export function warnDraftNotes(notes: DraftNote[], source: string): void {
  if (notes.length === 0) return;
  console.error(`警告: ${source} に、提出物に載るべきでない作業メモのような文言がある:`);
  for (const { line, text } of notes) console.error(`  ${line}行目: ${text.trim().slice(0, 80)}`);
}
