# CV — AIの作業案内

`README.md` が業務経歴書の本文。このリポジトリは公開されている。

- 月次更新は Skill `cv-monthly-update`（`.claude/skills/cv-monthly-update/SKILL.md`）の手順で行う。記録は `docs/cv-update-log.md`。端末ごとのパスは `.claude/settings.local.json`（gitignore済み）の `env` で渡し、リポジトリに絶対パスを書かない。
- 提出用の Word と PDF は `node scripts/build-docx.ts` で README.md から作る（出力は `.local/cv/`。PDF は LibreOffice がある場合だけ）。README.md を正本とし、Word を直接編集しない。
- スキルシートの Word と PDF は `node scripts/build-skill-sheet-docx.ts` で `CV_SKILL_SHEET` から作る。`--exclude` で `docs/cv-excluded-projects.md` の案件を外す。経験件数は各案件から数え直し、【要記入】の行は外す（スキルシート自体は変えない）。
- スクリプトは TypeScript（Node 24 で直接実行）と bash で書き、依存パッケージを増やさない。変更したら `node --test scripts/*.test.ts` と `shellcheck scripts/*.sh` を通す。PR と main への push で GitHub Actions（`.github/workflows/test.yml`）が同じ検査を行う。
- クライアント名・サービス名・人名・URL・未公開の事業情報を、本文・PR・コミットに書かない。業種＋用途で表す。
- 根拠のない経験・役割・成果を書かない。不明な点は `.local/`（gitignore済み）にメモして本人に確認する。
