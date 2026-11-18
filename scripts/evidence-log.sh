#!/usr/bin/env bash
# 根拠のリポジトリから、本人のコミットだけを git log で読む（すべてのブランチとリモートの控えが対象）。
# 使い方: evidence-log.sh <リポジトリ> [git log の引数...]
#   例: evidence-log.sh <repo> --since=2026-10-01 --until=2026-11-01 --format='%ad %s' --date=short
#       evidence-log.sh <repo> -1 --format=%ad --date=short
# 本人の名前とメールは固定。貸与PCなど、別の名前・メールでコミットする案件は、端末ごとの設定で足す:
#   CV_EVIDENCE_AUTHORS 足す作者の名前かメール。`:` 区切り（任意）。リポジトリには書かない
# 作者は正規表現ではなく、文字のとおりに照らす（部分一致）。
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "使い方: evidence-log.sh <リポジトリ> [git log の引数...]" >&2
  exit 2
fi

repo="$1"
shift

authors=(--author='Ohmiya-Mizuki' --author='m7xtgrmd.works@gmail.com')
if [[ -n "${CV_EVIDENCE_AUTHORS:-}" ]]; then
  IFS=: read -ra extra <<< "$CV_EVIDENCE_AUTHORS"
  for a in "${extra[@]}"; do
    [[ -n "$a" ]] && authors+=(--author="$a")
  done
fi

git -C "$repo" log --all --fixed-strings "${authors[@]}" "$@"
