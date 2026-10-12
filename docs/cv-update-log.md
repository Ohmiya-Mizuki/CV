# 業務経歴書の月次更新ログ

月次更新ループ（`.claude/skills/cv-monthly-update/SKILL.md`）の実施記録。追記型で、既存のエントリは書き換えない。
最終エントリの「調査期間の終わり」が、次回の調査開始日になる。

このリポジトリは公開されているため、ここには公開してよい要約だけを書く。根拠の詳細と本人への質問は `.local/cv-update/`（gitignore済み）に置く。

## 2026-10-12 ループ導入

- 調査期間の終わり: 2026-09-03（導入時点の README.md「最終更新日」。初回は 2026-09-03 以降の活動を調べる）
- 内容: 月次更新ループを導入。毎月1日 10:00 に Claude デスクトップアプリの定期タスク `cv-monthly-update` から起動する。
- 設計判断:
  - 実行場所: 根拠になる案件リポジトリは手元のMacにしかなく、クライアントのコードをクラウドや別ホストへ持ち出さないため、ローカルの定期タスクで動かす。GitHub Actions・クラウド実行・Mac mini は使わない。
  - 出力: Draft PR まで。マージは本人が行う。
  - 公開範囲: 根拠と質問は非公開メモへ分け、PR本文には要約だけを書く。
  - レビュー: 差分と根拠だけを渡した別エージェントが、誇張と公開してはいけない情報を確認する。
  - automation-harness（`.loopguardrails/`）は導入しない。スクリプトを持たないリポジトリのため、loop-review の6観点で設計した結果だけをここに残す。
- loop-review の6観点:
  - Automations: ○ 月次の定期タスク
  - Worktrees: ○ `../CV-worktrees/cv-update-YYYY-MM` で作業し、手元のブランチを汚さない
  - Skills: ○ `cv-monthly-update`
  - Plugins/connectors: △ 根拠はローカルの git log と `gh` のみ。案件のPR・チケットは見ない（関与の確認は質問で補う）
  - Sub-agents: ○ 手順8のレビュー
  - Memory: ○ このログ（公開）と `.local/cv-update/`（非公開）
