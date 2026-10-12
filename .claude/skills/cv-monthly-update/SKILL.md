---
name: cv-monthly-update
description: >
  業務経歴書（README.md）の月次更新ループの固定手順。前回更新以降の作業記録を集め、
  根拠のある差分だけをDraft PRにし、確認が必要な事項はローカルの非公開メモに残す。
  Use when the scheduled task fires, or the user asks 「CVの月次更新」「業務経歴書を最新化して」
  「/cv-monthly-update」.
---

# cv-monthly-update

作成日: 2026-10-12

このリポジトリは **PUBLIC**。PR本文・コミット・ブランチ名は誰でも読める前提で書く。

## 固定値

| 項目 | 値 |
| --- | --- |
| CVリポジトリ | `/Users/ohmiyamizuki/life/portfolio/CV`（本文は `README.md`） |
| 作業worktree | `/Users/ohmiyamizuki/life/portfolio/CV-worktrees/cv-update-YYYY-MM` |
| ブランチ | `cv-update/YYYY-MM` |
| 公開してよい記録 | `docs/cv-update-log.md`（追記型） |
| 非公開メモ | `/Users/ohmiyamizuki/life/portfolio/CV/.local/cv-update/YYYY-MM.md`（gitignore済み） |
| 本人の作者表記 | 名前 `Ohmiya-Mizuki` / メール `m7xtgrmd.works@gmail.com` |

`YYYY-MM` は実行日の年月。

## 手順（この順に実行する）

### 1. 重複実行を止める

- `gh pr list --repo Ohmiya-Mizuki/CV --state all --head cv-update/YYYY-MM` で当月のPRがあれば、何もせず終了する。
- 非公開メモ `.local/cv-update/YYYY-MM.md` が既にあり「変更なし」で終わっていれば終了する。

### 2. 調査期間を決める

- `origin/main` の `docs/cv-update-log.md` の最終エントリの「調査期間の終わり」を開始日とする。
- エントリがなければ `README.md` の「最終更新日」を開始日とする。
- 終わりは実行日。PRが出なかった月は記録を進めないため、翌月は自動で期間が延びる。

### 3. 根拠を集める（読み取りのみ）

対象は `/Users/ohmiyamizuki/life/client-projects/` 配下のGitリポジトリ（`archive/` を除く）。

```bash
git -C <repo> log --all --since=<開始日> --until=<終了日> \
  --author='Ohmiya-Mizuki' --author='m7xtgrmd.works@gmail.com' \
  --format='%ad %s' --date=short
```

- 本人のコミットがあるリポジトリ: 期間内の最初と最後の日付、件数、主な変更領域、導入された技術（`package.json`・`pyproject.toml`・`go.mod`・`*.tf` 等の差分）を拾う。
- 本人のコミットはないが期間内に更新があるリポジトリ（bot・AIエージェント経由の作業がありうる）: 「関与の確認が必要」として非公開メモに挙げるだけにする。
- `/Users/ohmiyamizuki/life/skill-sheet.md` の更新内容（`stat` の更新日時と本文）を補足として読む。
- `/Users/ohmiyamizuki/life/interview-prep/` は根拠にしない（回答案を職務経験の根拠にしない、という `catalog/career.md` のルール）。
- `.env`・秘密情報は読まない。

### 4. 差分を判断する

根拠と `README.md` を突き合わせ、次の3種に分ける。

| 区分 | 例 | 扱い |
| --- | --- | --- |
| 確定 | 「〜 現在」の案件に本人コミットが続いている／終わった案件の期間の終わりがコミット履歴で明らか／本人コミットで導入した技術を使用技術に追加 | README.md に反映する |
| 要確認 | 新しい案件らしき活動、担当範囲・役割・成果、チーム構成、期間の終わりが曖昧なもの | 非公開メモに質問として書く。README.md は変えない |
| 対象外 | 個人開発（`side-projects/`）、学習、面談の回答案 | 触れない |

推測で埋めない。案件の説明文・発揮したバリューは本人の言葉が必要なため、新規作成しない。

### 5. 公開してよいかを確認する

README.md の既存の書き方（「旅行業 OTA」「製造業向け」のような業種＋用途）に合わせ、
次を書かない: クライアント名・社名・サービス名・リポジトリ名・社内コードネーム・人名・URL・金額・未公開の事業情報。

### 6. 「確定」が0件なら

非公開メモに「変更なし」と根拠一覧・質問を書いて終了する。PRもコミットも作らない。

### 7. 反映する

```bash
cd /Users/ohmiyamizuki/life/portfolio/CV
git fetch origin
git worktree add -b cv-update/YYYY-MM ../CV-worktrees/cv-update-YYYY-MM origin/main
```

worktree内で:

1. `README.md` に「確定」分を反映し、「最終更新日」を実行日（例: `2026 年 11 月 1 日（日）`）に更新する。表記は既存の全角・半角スペースの規則に合わせる。
2. `docs/cv-update-log.md` の末尾にエントリを追記する（既存エントリは書き換えない）。

### 8. 別エージェントにレビューさせる

自分の判断理由は渡さず、`git diff origin/main` と手順3の根拠一覧だけを渡したサブエージェントに次を確認させる。

- 根拠のない記述・誇張がないか
- 手順5の公開してはいけない情報が含まれていないか

指摘があれば直す。直せない指摘は該当箇所を差分から外し、非公開メモの質問に回す。

### 9. Draft PRを作る

```bash
git commit -m "docs: YYYY年M月時点の業務経歴を更新"
git push -u origin cv-update/YYYY-MM
gh pr create --draft --base main --title "docs: YYYY年M月時点の業務経歴を更新" --body-file <本文>
```

PR本文には「変更点の要約」と「本人確認待ちの質問が N 件あり、非公開メモにある」ことだけを書く。質問の中身・根拠の詳細はPRに書かない。
マージ・Ready化はしない（本人が行う）。

### 10. 非公開メモを仕上げる

`.local/cv-update/YYYY-MM.md` に以下を書く。

- 調査期間
- 根拠一覧（リポジトリごとのコミット件数・期間・技術）
- 反映した内容とPRのURL
- 本人への質問（回答をもらったら次回以降の手作業で README.md に反映する）

最後に、作業worktreeは残したまま、PRのURLと質問件数を報告して終了する。
PRマージ後の掃除は `git worktree remove ../CV-worktrees/cv-update-YYYY-MM`。

## 判断に迷ったとき

- 迷ったら「要確認」に倒す。月次ループの目的は抜け漏れを防ぐことで、本人の確認を省くことではない。
- 手順やルールを変えたい時はこのSKILL.mdを変更し、`docs/cv-update-log.md` に経緯を残す。
