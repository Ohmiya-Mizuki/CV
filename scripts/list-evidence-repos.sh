#!/usr/bin/env bash
# 月次更新の根拠を探すGitリポジトリを列挙する（1行1リポジトリ、重複したworktreeは1つにまとめる）。
# 端末ごとの設定は環境変数で受け取る:
#   CV_EVIDENCE_DIRS    探すディレクトリ。`:` 区切り（必須）
#   CV_EVIDENCE_EXCLUDE 除外するディレクトリ名。`:` 区切り（任意）
# node_modules と隠しディレクトリ（.git 以外）は常に見ない。
set -euo pipefail

if [[ -z "${CV_EVIDENCE_DIRS:-}" ]]; then
  echo "CV_EVIDENCE_DIRS が未設定です。.claude/settings.local.json の env に設定してください。" >&2
  exit 2
fi

IFS=: read -ra dirs <<< "$CV_EVIDENCE_DIRS"
for d in "${dirs[@]}"; do
  if [[ ! -d "$d" ]]; then
    echo "CV_EVIDENCE_DIRS のディレクトリが存在しません: $d" >&2
    exit 2
  fi
done

prune=(-name node_modules -o \( -name ".*" ! -name .git \))
if [[ -n "${CV_EVIDENCE_EXCLUDE:-}" ]]; then
  IFS=: read -ra excludes <<< "$CV_EVIDENCE_EXCLUDE"
  for e in "${excludes[@]}"; do
    prune+=(-o -name "$e")
  done
fi

find "${dirs[@]}" -maxdepth 6 \( "${prune[@]}" \) -prune -o -name .git -print -prune |
  while read -r git_path; do
    repo="$(dirname "$git_path")"
    common="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || continue
    # 同じリポジトリのworktreeは、本体（.git の親）を代表にする
    dirname "$common"
  done | sort -u
