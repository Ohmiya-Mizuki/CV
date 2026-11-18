# 届いた受託案件の選別と、経歴書の書き換え案（case-screening）

届いた受託案件の紹介メールを、スキルシート（職務経歴の事実の正本）と照らして選別し、案件ごとに「合う点（根拠の引用つき）・足りない点・面談で確かめる事項」を本人だけが見る報告にまとめる。本人が選んだ案件があれば、その案件に合わせた業務経歴書（`README.md`）の書き方の案を、下書きの PR で出す。

- **外へ送らない**: 応募・返信・面談の申し込みはしない。Gmail の書き込みのツールは、許可の一覧で断る
- **中身を外に出さない**: 案件の本文・単価・会社名・紹介元は、本人だけが見る報告（Mac mini の手元の `~/mac-mini-ci/case-screening/reports/`）にだけ書く。issue・PR・Slack には、件数とリンクだけ。法人の Drive には置かない（キャリアの書類は個人事業の Drive に1か所だけ置く決まりのため。Mac mini では個人事業の Drive を同期していない）
- **事実を盛らない**: 合う点と書き換えには、スキルシートの文をそのまま引用させ、含まれなければ回ごと失敗にする。根拠に「主導」がないのに「主導」を足す書き換え、コミット数のアピール、作業メモのような文言も落とす
- **既定は止めておく**: 設定の `enabled` が `true` のときだけ動く。外へ出すのは `dryRun` が `false` のときだけ

ループ仕様は [docs/loops/case-screening.md](../docs/loops/case-screening.md)。

## 流れ

1. LaunchAgent（`local.automation-infra.case-screening`）が毎朝 6:40 に `scripts/case-screening-run.sh` を起動する（朝の1通の 7:10 より前）
2. 止める変数を見る。`enabled` が `true` でなければ「止めている」と1行書いて終わる
3. 経路（設定の `sources`）ごとに、前回の成功から後に届いた案件のメールを集める。`claude-gmail` の経路は AI が claude.ai の Gmail のコネクタで検索し、`gmail-api` の経路は `scripts/case-screening-gmail.ts` が読み取りだけの認証で手元へ取り込む
4. ヘッドレスの Claude Code が `prompt-screen.md` の手順で、集めたメールをスキルシートと照らし、結果の JSON を書く。選んだ印のラベル（`selectLabel`）が付いたスレッドも拾う
5. `scripts/case-screening.ts screen` が結果を検査し（形、検索で見つかったスレッドか、合う点の引用がスキルシートにあるか、確かめる事項があるか）、新しい案件だけで報告と知らせを組み立てる
6. 報告を手元（`reportDir`。既定は `~/mac-mini-ci/case-screening/reports/`）に置き、案内の issue（`inboxIssue`。ラベル `inbox:output` と `owner:freelance`）へ件数だけのコメントを書く。[朝の1通](https://github.com/nogawa-l-prince/automation-ops/blob/main/morning-digest/README.md)が `#inbox-freelance` に件数とリンクだけを届ける
7. 選んだ印のラベルが付いた案件のうち、まだ案を出していないものが1件あれば、`prompt-tailor.md` の手順で書き換え案を作らせ、`scripts/case-screening.ts tailor` が検査して `README.md` に当て、`cv-tailor/<日付>-<時刻>` のブランチから下書きの PR を作る（1回に1件まで）。PR の URL も案内の issue に書く

本人がすること: 報告を読み、経歴書の案がほしい案件のメールに、選んだ印のラベルを付ける。PR を見て、使うならマージ、使わないなら閉じる。応募・返信は本人が行う。

## 設定（`~/mac-mini-ci/case-screening/config.json`、0600）

例は [config.example.json](config.example.json)。

| 項目 | 内容 |
| --- | --- |
| `enabled` | 止める変数。`true` のときだけ動く。ない・読めないときは止める |
| `dryRun` | `false` のときだけ外へ出す（issue へのコメント、下書きの PR）と、報告を `reportDir` へ置く。それ以外は、全部 `state/results/` に残すだけ |
| `sources` | 案件の紹介が届く経路の一覧。経路を足すときは、ここに1つ足す（下の表）。紹介元の送信元は端末ごとの設定に書き、リポジトリには書かない |
| `selectLabel` | 本人が「経歴書の案がほしい」と選んだ印の Gmail のラベル。空なら経歴書の案は作らない |
| `skillSheet` | スキルシート（事実の正本）の絶対パス |
| `cvRepo` | CV の手元のクローン（書き換え案のブランチと PR を作る）。省くと、このスクリプトのあるリポジトリ |
| `reportDir` | 報告の置き場。省くと `~/mac-mini-ci/case-screening/reports/` |
| `reportPlace` | 知らせに書く、報告の置き場の呼び名 |
| `inboxIssue` | 案内の issue（`Ohmiya-Mizuki/life#<番号>`）。`dryRun` が `false` のとき必須 |

`sources` の1つ:

| 項目 | 内容 |
| --- | --- |
| `name` | 経路の名前（英小文字・数字・ハイフン）。報告に出る |
| `kind` | `claude-gmail`（claude.ai の Gmail のコネクタ。Mac mini の claude にいまつながっているのは法人の Gmail）か `gmail-api`（読み取りだけの認証で取り込む。個人事業の Gmail） |
| `account` | 報告のリンクを開くアカウントのアドレス |
| `query` | 案件の紹介のメールを絞る Gmail の検索（`from:(<紹介元のドメイン> OR …)`）。送信元の足し引きはここで行う |
| `tokenFile` | `gmail-api` だけ。認証のファイル（0600。下の「個人事業の Gmail」で作る）。ない・切れたときは、その回を「本人のサインインが要る」で失敗にする |

## 状態（`~/mac-mini-ci/case-screening/state/`）

| ファイル | 中身 |
| --- | --- |
| `runs.log` | 1回1行。止めている・見送り・成功（件数）・失敗（理由） |
| `last-success` | 前回の成功の開始時刻（UNIX 時間）。次の回の検索の起点 |
| `seen.txt` | 報告済みのスレッド ID（dry-run でも進める） |
| `cases/<スレッドID>.json` | 案件ごとの選別の結果（経歴書の案を作るときに読む。本人だけ） |
| `tailored.txt` | 経歴書の案を出したスレッド ID（dry-run では足さない） |
| `results/<時刻>.*` | AI の結果（`screen.json`・`tailor.json`）、報告（`report.md`）、知らせ（`notice.txt`）、書き換えの差分（`tailor.diff`）、PR の本文（`pr.md`） |
| `runs/` | ヘッドレス実行の記録 |
| `denials.jsonl` | 許可の一覧で断られた操作 |

## 試しの実行（外へ出さない）

`dryRun: true` のまま手で動かす。AI を飛ばして、前の回の結果ファイルで検査と組み立てだけを確かめることもできる（このときは取り込みもしない）。`CASE_SCREENING_SINCE` に UNIX 時間を渡すと、起点を決めて読み直す。

```sh
bash ~/mac-mini-ci/case-screening/current/scripts/case-screening-run.sh
CASE_SCREENING_RESULT_FILE=結果.json CASE_SCREENING_TAILOR_FILE=書き換え案.json bash scripts/case-screening-run.sh
```

## 個人事業の Gmail（`gmail-api` の経路。本人が1回だけ行う）

Mac mini の claude.ai のコネクタは法人の Gmail にだけつながっているため、個人事業の Gmail は、読み取りだけの認証で別に読む。いまはまだ用意していないので、この経路を `sources` に足すと「本人のサインインが要る」で止まる。

1. Google Cloud に、この仕組み専用のプロジェクトを作る（ほかの仕組みと相乗りしない。例: `case-screening`）。作るアカウントは個人事業のアカウント
2. Gmail API を有効にする
3. OAuth 同意画面を「外部」で作り、スコープに `gmail.readonly` だけを足す。公開ステータスを「本番環境」にする（「テスト」のままだと、認証が7日で切れる。本人だけが使うので、確認前のアプリの警告が出るのはそのまま進めてよい）
4. 認証情報で「OAuth クライアント ID」を「デスクトップ アプリ」で作り、JSON を落とす
5. Mac mini の画面のターミナルで、次を動かし、表示された URL をブラウザで開いて、個人事業のアカウントでサインインして許可する。認証のファイルが 0600 で書かれる（値は画面に出ない）。落とした JSON は、そのあと消す

   ```sh
   node ~/mac-mini-ci/case-screening/current/scripts/case-screening-gmail-auth.ts --client <落とした JSON> --out ~/mac-mini-ci/ai-runtime/secrets/case-screening-gmail-freelance.json
   ```

6. `config.json` の `sources` に `gmail-api` の経路を足す（例の `freelance`）

## 導入（Mac mini。本人が行う）

前提: `jq`、`perl`、`gh`（個人のアカウントで認証済み。CV に push と PR、life の issue にコメントできる）、`claude`（Pro/Max でログイン済み。claude.ai の Gmail のコネクタ（法人の Gmail）を接続済み）、Node 24。個人事業の Gmail も読むなら、上の「個人事業の Gmail」を先に済ませる。

1. CV を `~/mac-mini-ci/case-screening/current` にクローンする（`cvRepo` もここにする。更新は `git -C … pull --ff-only`）
2. life に案内の issue を作り、ラベル `inbox:output` と `owner:freelance` を付ける（題に案件の中身を書かない。例: 「案件の選別の知らせ」）
3. `config.json` を例から写し（0600）、`enabled: true`・`dryRun: true` で埋める
4. 手で1回動かし、`state/runs.log` の最後が `結果=ok`、`state/denials.jsonl` が空、`state/results/*.report.md` と Gmail が合うことを確かめる
5. LaunchAgent を登録する（`cp case-screening/local.automation-infra.case-screening.plist ~/Library/LaunchAgents/` → `launchctl bootstrap "gui/$(id -u)" …`）
6. 数日の dry-run で報告を見比べ、よければ `dryRun: false` にする

止め方: `config.json` の `enabled` を `false` にする（LaunchAgent は動くが、何もせずに終わる）。見張りは、Mac mini の定期のジョブの見張り（automation-ops の `mac-mini-jobs-watch`）が `runs.log` の更新時刻と最後の終了コードを読む。Healthchecks の check は増やさない。
