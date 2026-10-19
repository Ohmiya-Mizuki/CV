// テスト用の一時ディレクトリと Git リポジトリを作る補助関数
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after } from "node:test";

/** テスト終了時に消える一時ディレクトリ（macOS の /var → /private/var を解決した実パス） */
export function tempDir(prefix = "cv-test-"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** dir に1コミットあるリポジトリを作る */
export function initRepo(dir: string, files: Record<string, string> = { "README.md": "# test\n" }): string {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  for (const [path, content] of Object.entries(files)) writeFile(join(dir, path), content);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

export const hasCommand = (name: string): boolean => spawnSync("sh", ["-c", `command -v ${name}`]).status === 0;

/** スキルシートの試験用データ（基本情報・工程の表・3案件。案件1に【要記入】がある） */
export const SHEET = `# 基本情報

| 項目 | 内容 |
| --- | --- |
| 氏名 | テスト |

## 担当可能な工程

| 工程 | 経験の有無 | 経験件数 | 習熟度 |
| --- | --- | --- | --- |
| 要件定義 | 有 | 9件 | B |
| 実装 | 有 | 9件 | A |
| 総合テスト | 有 | 1件 | B |

## 保有資格

なし

# 職務経歴

# 案件1

| 項目 | 内容 |
| --- | --- |
| 案件名 | 新しい案件 |
| 担当工程 | 要件定義、実装 |
| クラウドおよびインフラ | 【要記入】 |

# 案件2

| 項目 | 内容 |
| --- | --- |
| 案件名 | 載せない案件 |
| 担当工程 | 実装 |

# 案件3

| 項目 | 内容 |
| --- | --- |
| 案件名 | 古い案件 |
| 担当工程 | 実装、総合テスト |
`;
