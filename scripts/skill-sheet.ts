// スキルシート（Markdown）を提出用の Word に変換する前の加工。どれも文字列を受け取って返すだけで、ファイルは触らない。

const CASE_HEADING = /^# 案件\d+$/m;
const PLACEHOLDER = "【要記入】";

/** docs/cv-excluded-projects.md の表から「スキルシートの案件名」の列を取り出す */
export function parseExcludedNames(markdown: string): string[] {
  const rows = markdown.split("\n").filter((line) => line.startsWith("|"));
  // 1 行目は見出し、2 行目は区切り
  return rows
    .slice(2)
    .map((row) => row.split("|")[1]?.trim() ?? "")
    .filter(Boolean);
}

const projectName = (section: string): string | undefined => section.match(/^\| 案件名 \| (.*?) \|$/m)?.[1];

/** 指定した案件名の「# 案件N」の節を外し、残りを 1 から振り直す。見つからなかった名前も返す */
export function excludeProjects(
  markdown: string,
  names: string[],
): { markdown: string; excluded: string[]; notFound: string[] } {
  const first = markdown.search(CASE_HEADING);
  if (first === -1) return { markdown, excluded: [], notFound: [...names] };
  const head = markdown.slice(0, first);
  const sections = markdown
    .slice(first)
    .split(/(?=^# 案件\d+$)/m)
    .filter((section) => CASE_HEADING.test(section));
  const excluded: string[] = [];
  const kept = sections.filter((section) => {
    const name = projectName(section);
    if (name !== undefined && names.includes(name)) {
      excluded.push(name);
      return false;
    }
    return true;
  });
  const renumbered = kept.map((section, i) => section.replace(CASE_HEADING, `# 案件${i + 1}`));
  return {
    markdown: head + renumbered.join(""),
    excluded,
    notFound: names.filter((name) => !excluded.includes(name)),
  };
}

export type ProcessChange = { process: string; before: string; after: string };

/**
 * 「担当可能な工程」の表の経験件数を、各案件の「担当工程」から数え直す。
 * 案件を外したときに件数が合わなくなるのを防ぐため。習熟度は変えない。
 */
export function recountProcesses(markdown: string): { markdown: string; changes: ProcessChange[] } {
  const counts = new Map<string, number>();
  for (const match of markdown.matchAll(/^\| 担当工程 \| (.*?) \|$/gm)) {
    for (const process of match[1].split("、").map((p) => p.trim()).filter(Boolean)) {
      counts.set(process, (counts.get(process) ?? 0) + 1);
    }
  }
  const changes: ProcessChange[] = [];
  const section = markdown.match(/^## 担当可能な工程\n[\s\S]*?(?=^## |^# |(?![\s\S]))/m);
  if (!section) return { markdown, changes };
  const updated = section[0].replace(
    /^\| ([^|]+?) \| (有|無) \| (\d+)件 \| ([^|]+?) \|$/gm,
    (row, process: string, had: string, count: string, level: string) => {
      const n = counts.get(process) ?? 0;
      const next = `| ${process} | ${n > 0 ? "有" : "無"} | ${n}件 | ${level} |`;
      if (next !== row) changes.push({ process, before: `${had}・${count}件`, after: `${n > 0 ? "有" : "無"}・${n}件` });
      return next;
    },
  );
  return { markdown: markdown.replace(section[0], updated), changes };
}

/** 【要記入】の表の行を外す（空欄が並ぶと見栄えが悪いため。正本は変えない） */
export function dropPlaceholderRows(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => !(line.startsWith("|") && line.includes(PLACEHOLDER)))
    .join("\n");
}

/**
 * 表の区切り行の「-」の数を、Word での列幅の比率として調整する。
 * スキルシートは「| --- | --- |」のように同じ数で書いてあり、そのままでは全列が同じ幅になるため。
 */
export function widenTableColumns(markdown: string): string {
  const lines = markdown.split("\n");
  return lines
    .map((line, i) => {
      const cells = line.match(/^\|(?: --- \|)+$/) ? line.split("|").length - 2 : 0;
      if (cells === 2) return "| ------ | ------------------------------ |";
      if (cells === 3) return "| ---------- | -------------------- | ---------- |";
      if (cells === 4) {
        // 「直近の使用時期」や工程の表は 1 列目が長い。それ以外は 4 列目に説明が入る
        const header = lines[i - 1] ?? "";
        return /直近|経験件数/.test(header)
          ? "| ------------------------ | ------ | ---- | -------- |"
          : "| ---------- | ---- | ---- | ------------------------------ |";
      }
      return line;
    })
    .join("\n");
}
