#!/bin/bash
# 届いた受託案件を1回分選別し、選んだ案件があれば経歴書の書き換え案を下書きの PR にする。
#
# 止める変数: 設定（config.json）の enabled。ない・true でないときは、何もせずに「止めている」と記録して終わる（既定）。
# 外へ出すのは、dryRun が false のときだけ。外へ出すのは、案内の issue へ件数のコメントと、CV への下書きの PR だけ。
# 応募・返信・面談の申し込みはしない（Gmail の書き込みのツールは許可の一覧で断る）。
#
# 使い方は case-screening/README.md。試しの実行は、AI の結果ファイルを渡して AI を飛ばせる:
#   CASE_SCREENING_RESULT_FILE=結果.json bash scripts/case-screening-run.sh
set -u

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"
base="${CASE_SCREENING_HOME:-$HOME/mac-mini-ci/case-screening}"
config="$base/config.json"
state="$base/state"
timeout_seconds="${CASE_SCREENING_TIMEOUT_SECONDS:-900}"
node_bin="${CASE_SCREENING_NODE:-node}"

mkdir -p "$state/runs" "$state/results" "$state/cases" "$state/work"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" | tee -a "$state/runs.log"
}

fail_run() {
  log "結果=fail 理由=$1${2:-}"
  exit 1
}

conf() {
  jq -r "$1 // empty" "$config" 2>/dev/null
}

# 止める変数。既定は止めておく
if [ "$(conf '.enabled')" != "true" ]; then
  log "結果=stopped（config.json の enabled が true でない）"
  exit 0
fi

dry_run=true
[ "$(jq -r '.dryRun' "$config" 2>/dev/null)" = "false" ] && dry_run=false

lock="$state/run.lock"
if ! mkdir "$lock" 2>/dev/null; then
  if [ -n "$(find "$lock" -maxdepth 0 -mmin +$((timeout_seconds / 60 + 10)) 2>/dev/null)" ]; then
    rm -rf "$lock"
    mkdir "$lock" || exit 0
  else
    log "見送り（前の実行が進行中）"
    exit 0
  fi
fi
trap 'rm -rf "$lock"' EXIT

skill_sheet="$(conf '.skillSheet')"
[ -f "$skill_sheet" ] || fail_run "スキルシートがない（config.json の skillSheet）"
select_label="$(conf '.selectLabel')"
# 案件の届く経路（config.json の sources）。経路ごとに種類を選ぶ: claude-gmail（claude.ai の Gmail のコネクタ）、gmail-api（読み取りだけの認証で取り込む）
sources_count="$(jq '(.sources // []) | length' "$config" 2>/dev/null)"
case "$sources_count" in '' | *[!0-9]* | 0) fail_run "案件の届く経路がない（config.json の sources）" ;; esac
accounts="$(jq -c '[(.sources // [])[] | {(.name): (.account // "")}] | add // {}' "$config")"

started="$(date +%s)"
stamp="$(date '+%Y%m%dT%H%M%S')"
today="$(date '+%Y-%m-%d')"
since="$(cat "$state/last-success" 2>/dev/null || true)"
case "$since" in '' | *[!0-9]*) since=0 ;; esac
[ $((started - since)) -gt $((7 * 86400)) ] && since=$((started - 3 * 86400))
# 試しの実行で、起点を決めて読み直すとき（状態は進む）
case "${CASE_SCREENING_SINCE:-}" in '' | *[!0-9]*) ;; *) since="$CASE_SCREENING_SINCE" ;; esac

# AI に読ませるものは、作業フォルダの中へ写す（許可の一覧を作業フォルダの中だけにするため）
inputs="$state/work/inputs"
mkdir -p "$inputs"
# 経歴書は、CV の手元のクローン（config.json の cvRepo。なければこのスクリプトのあるリポジトリ）の origin/main から読む
cv_repo="$(conf '.cvRepo')"
cv_repo="${cv_repo:-$repo}"
git -C "$cv_repo" fetch -q origin main || fail_run "CV の main を取り込めない（config.json の cvRepo）"
cp "$skill_sheet" "$inputs/skill-sheet.md"
cp "$repo/case-screening/prompt-screen.md" "$repo/case-screening/prompt-tailor.md" "$inputs/"
git -C "$cv_repo" show origin/main:README.md >"$inputs/cv.md" || fail_run "経歴書を読めない"

# 経路ごとの読み方を、AI に渡す一覧（sources.md）にする。gmail-api の経路は、ここで手元へ取り込む
rm -rf "$inputs/mail"
mkdir -p "$inputs/mail"
printf '# 案件の届く経路\n\n' >"$inputs/sources.md"
i=0
while [ "$i" -lt "$sources_count" ]; do
  name="$(jq -r ".sources[$i].name // empty" "$config")"
  kind="$(jq -r ".sources[$i].kind // empty" "$config")"
  query="$(jq -r ".sources[$i].query // empty" "$config")"
  i=$((i + 1))
  case "$name" in '' | *[!a-z0-9-]*) fail_run "経路の名前は英小文字・数字・ハイフンにする（config.json の sources[].name）" ;; esac
  [ -n "$query" ] || fail_run "経路 ${name} の検索がない（config.json の sources[].query）"
  case "$kind" in
    claude-gmail)
      printf -- '- 経路 「%s」: claude.ai の Gmail のコネクタで 「after:%s %s」 を検索する。選んだ印は 「label:%s」 で検索する\n' \
        "$name" "$since" "$query" "${select_label:-（なし。検索しない）}" >>"$inputs/sources.md"
      ;;
    gmail-api)
      token_file="$(jq -r ".sources[$i - 1].tokenFile // empty" "$config")"
      token_file="${token_file/#\~/$HOME}"
      if [ -z "${CASE_SCREENING_RESULT_FILE:-}" ]; then
        if ! imported="$("$node_bin" "$here/case-screening-gmail.ts" --token "$token_file" --query "$query" --after "$since" \
          --out "$inputs/mail/$name" ${select_label:+--select-label "$select_label"} 2>"$state/runs/$stamp.$name.err")"; then
          fail_run "経路 ${name} の Gmail を取り込めない: $(head -n 1 "$state/runs/$stamp.$name.err")"
        fi
        [ "$(printf '%s' "$imported" | jq -r '.overflow')" = "false" ] || fail_run "経路 ${name} のスレッドが50件を超えた（検索を絞る）"
      fi
      printf -- '- 経路 「%s」: 検索はしない。「state/work/inputs/mail/%s/threads.txt」 の ID ごとに 「<ID>.txt」 を読む。選んだ印は 「selected.txt」\n' \
        "$name" "$name" >>"$inputs/sources.md"
      ;;
    *) fail_run "経路 ${name} の種類 ${kind} を知らない（claude-gmail か gmail-api）" ;;
  esac
done

run_claude() { # $1=手順のファイル $2=書き添える指示 $3=記録の名前
  local out="$state/runs/$stamp.$3.json" status=0 verdict
  cd "$base" || fail_run "作業フォルダがない"
  perl -e 'alarm shift; exec @ARGV' "$timeout_seconds" \
    claude --print --setting-sources '' --settings "$repo/case-screening/claude-settings.json" \
    --permission-mode dontAsk --output-format json \
    "state/work/inputs/$1 を読み、その手順を1回分実行する。$2" \
    >"$out" 2>"$state/runs/$stamp.$3.err" || status=$?
  jq -c --arg at "$stamp" '.permission_denials[]? | {at: $at, tool: .tool_name}' "$out" >>"$state/denials.jsonl" 2>/dev/null || true
  verdict="$(jq -r '.result // ""' "$out" 2>/dev/null | tr -d '\r' | awk 'NF { last = $0 } END { print last }')"
  [ "$status" -eq 0 ] && [ "$verdict" = "RESULT ok" ]
}

# 1. 選別（AI はメールを読んで結果ファイルを書くだけ）
result="state/results/$stamp.screen.json"
if [ -n "${CASE_SCREENING_RESULT_FILE:-}" ]; then
  cp "$CASE_SCREENING_RESULT_FILE" "$base/$result"
else
  auth="$(claude --setting-sources '' --settings '{"forceLoginMethod":"claudeai"}' auth status --json 2>/dev/null || true)"
  printf '%s' "$auth" | jq -e '.loggedIn == true and .authMethod == "claude.ai"' >/dev/null 2>&1 ||
    fail_run "Claude のサブスク認証が確認できない"
  run_claude prompt-screen.md \
    "経路の一覧は state/work/inputs/sources.md。スキルシートは state/work/inputs/skill-sheet.md。結果ファイルは ${result}。" \
    screen || fail_run "選別の AI の実行が失敗した" " 記録=runs/$stamp.screen.json"
fi
[ -f "$base/$result" ] || fail_run "選別の結果ファイルがない"
[ "$(jq -r '.overflow // false' "$base/$result" 2>/dev/null)" = "true" ] && fail_run "スレッドが50件を超えた（経路の検索を絞る）"

report="$state/results/$stamp.report.md"
notice="$state/results/$stamp.notice.txt"
new_cases="$state/results/$stamp.cases.json"
report_place="$(conf '.reportPlace')"
report_place="${report_place:-Mac mini の手元（~/mac-mini-ci/case-screening/reports/）}"
if ! counts="$("$node_bin" "$here/case-screening.ts" screen --result "$base/$result" --skill-sheet "$inputs/skill-sheet.md" \
  --seen "$state/seen.txt" --date "$today" --report "$report" --notice "$notice" --cases "$new_cases" \
  --report-place "$report_place" --accounts "$accounts" 2>"$state/runs/$stamp.check.err")"; then
  fail_run "選別の結果の検査に失敗: $(head -n 1 "$state/runs/$stamp.check.err")"
fi
new_count="$(printf '%s' "$counts" | jq -r '.new' 2>/dev/null)"
case "$new_count" in '' | *[!0-9]*) fail_run "選別の結果の検査が件数を返さない" ;; esac

# 案件ごとの中身は、経歴書の案を作るときのために、手元（本人だけ）に残す
jq -c '.[]' "$new_cases" | while IFS= read -r c; do
  id="$(printf '%s' "$c" | jq -r '.threadId')"
  printf '%s\n' "$c" >"$state/cases/$id.json"
done

posted=""
if [ "$new_count" -gt 0 ]; then
  report_dir="$(conf '.reportDir')"
  report_dir="${report_dir:-$base/reports}"
  if [ "$dry_run" = false ]; then
    if ! { mkdir -p "$report_dir" && cp "$report" "$report_dir/$today-$(date '+%H%M').md"; }; then
      fail_run "報告を置けない（config.json の reportDir）"
    fi
  fi
  if [ "$dry_run" = false ]; then
    issue="$(conf '.inboxIssue')"
    case "$issue" in */*#[0-9]*) ;; *) fail_run "案内の issue がない（config.json の inboxIssue）" ;; esac
    gh issue comment "${issue##*#}" --repo "${issue%%#*}" --body-file "$notice" >/dev/null ||
      fail_run "案内の issue へ書けない"
    posted="コメント済み"
  fi
fi

# 2. 選んだ案件の経歴書の案（1回に1件まで）
tailored_note=""
selected_id="$(jq -r '(.selected // [])[]' "$base/$result" | while IFS= read -r id; do
  if [ -f "$state/cases/$id.json" ] && ! grep -qx "$id" "$state/tailored.txt" 2>/dev/null; then
    printf '%s\n' "$id"
    break
  fi
done)"
if [ -n "$selected_id" ]; then
  edits="state/results/$stamp.tailor.json"
  if [ -n "${CASE_SCREENING_TAILOR_FILE:-}" ]; then
    cp "$CASE_SCREENING_TAILOR_FILE" "$base/$edits"
  else
    cp "$state/cases/$selected_id.json" "$inputs/case.json"
    run_claude prompt-tailor.md \
      "案件は state/work/inputs/case.json、経歴書は state/work/inputs/cv.md、スキルシートは state/work/inputs/skill-sheet.md。結果ファイルは ${edits}。" \
      tailor || fail_run "経歴書の案の AI の実行が失敗した" " 記録=runs/$stamp.tailor.json"
  fi
  work="$state/work/tailor-$stamp"
  branch="cv-tailor/$today-$(date '+%H%M')"
  git -C "$cv_repo" worktree add -q -b "$branch" "$work" origin/main || fail_run "作業用の worktree を作れない"
  if ! tailor_counts="$("$node_bin" "$here/case-screening.ts" tailor --edits "$base/$edits" --readme "$work/README.md" \
    --skill-sheet "$inputs/skill-sheet.md" --case "$state/cases/$selected_id.json" \
    --pr-body "$state/results/$stamp.pr.md" 2>"$state/runs/$stamp.tailor-check.err")"; then
    git -C "$cv_repo" worktree remove --force "$work"
    git -C "$cv_repo" branch -q -D "$branch"
    fail_run "経歴書の案の検査に失敗: $(head -n 1 "$state/runs/$stamp.tailor-check.err")"
  fi
  git -C "$work" diff >"$state/results/$stamp.tailor.diff"
  if [ "$dry_run" = false ]; then
    if ! { git -C "$work" commit -q -am "docs: 選んだ案件に合わせて業務経歴書の書き方を直す案" &&
      git -C "$work" push -q -u origin "$branch"; }; then
      fail_run "経歴書の案のブランチを push できない"
    fi
    pr_url="$(cd "$work" && gh pr create --draft --base main --head "$branch" \
      --title "docs: 選んだ案件に合わせた業務経歴書の書き方の案" --body-file "$state/results/$stamp.pr.md")" ||
      fail_run "下書きの PR を作れない"
    issue="$(conf '.inboxIssue')"
    printf '業務経歴書の書き方の案（下書きの PR）: %s\n' "$pr_url" >"$state/results/$stamp.pr-notice.txt"
    gh issue comment "${issue##*#}" --repo "${issue%%#*}" --body-file "$state/results/$stamp.pr-notice.txt" >/dev/null || true
    tailored_note=" 経歴書の案=$pr_url $tailor_counts"
  else
    tailored_note=" 経歴書の案=results/$stamp.tailor.diff $tailor_counts"
  fi
  git -C "$cv_repo" worktree remove --force "$work"
  if [ "$dry_run" = false ]; then
    printf '%s\n' "$selected_id" >>"$state/tailored.txt"
  else
    git -C "$cv_repo" branch -q -D "$branch"
  fi
fi

# 知らせ済みの印と、次の起点を進める（dry-run でも進める。有効にしたあとに同じものを改めて知らせない）
jq -r '.[].threadId' "$new_cases" >>"$state/seen.txt"
printf '%s\n' "$started" >"$state/last-success"
log "結果=ok dry-run=$dry_run 新しい案件=$new_count $(printf '%s' "$counts" | jq -c 'del(.new)')${posted:+ $posted}${tailored_note}"
