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
