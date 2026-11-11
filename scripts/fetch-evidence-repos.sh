#!/usr/bin/env bash
# 月次更新の根拠のリポジトリに、リモートの最新を取り込む（git fetch）。
# 標準入力: リポジトリのパス（1行1つ。list-evidence-repos.sh の出力）
# 標準出力: 「結果<TAB>パス」を1行ずつ。結果は次の3つ
#   fetched    すべてのリモートを取り込めた
#   failed     取り込めなかった（権限がない・見つからない・通信の失敗・打ち切り・リポジトリでない）
#   no-remote  リモートがない（手元の履歴だけが根拠）
# 取り込めないリポジトリがあっても止まらず、終了コードは 0。
#
# - pull はしない。作業ツリーとローカルのブランチを変えない
# - リモートで消えたブランチの控えを消さない（--no-prune）。そこにしかない本人のコミットを残すため
# - 認証の入力を待たない。1つのリポジトリにつき CV_EVIDENCE_FETCH_TIMEOUT 秒（既定 60）で打ち切る
set -uo pipefail

limit="${CV_EVIDENCE_FETCH_TIMEOUT:-60}"
if [[ ! "$limit" =~ ^[1-9][0-9]*$ ]]; then
  echo "CV_EVIDENCE_FETCH_TIMEOUT は 1 以上の整数（秒）で指定してください: $limit" >&2
  exit 2
fi

export GIT_TERMINAL_PROMPT=0
export GCM_INTERACTIVE=never
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -o BatchMode=yes"

# git が起動した通信用の子プロセスごと止める
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2> /dev/null); do
    kill_tree "$child"
  done
  kill "$1" 2> /dev/null
}

# 取り込みを裏で動かし、秒数を過ぎたら止める（macOS には timeout コマンドがない）
fetch_all() {
  local repo="$1" pid waited=0
  git -C "$repo" fetch --all --no-prune --quiet < /dev/null > /dev/null 2>&1 &
  pid=$!
  while kill -0 "$pid" 2> /dev/null; do
    if ((waited >= limit * 10)); then
      kill_tree "$pid"
      wait "$pid" 2> /dev/null
      return 124
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  wait "$pid"
}

while IFS= read -r repo; do
  [[ -z "$repo" ]] && continue
  if ! remotes="$(git -C "$repo" remote 2> /dev/null)"; then
    printf 'failed\t%s\n' "$repo"
  elif [[ -z "$remotes" ]]; then
    printf 'no-remote\t%s\n' "$repo"
  elif fetch_all "$repo"; then
    printf 'fetched\t%s\n' "$repo"
  else
    printf 'failed\t%s\n' "$repo"
  fi
done
