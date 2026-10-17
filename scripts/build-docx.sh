#!/usr/bin/env bash
# README.md（業務経歴書の正本）から提出用の Word を作る。
# 出力は本体のチェックアウトの .local/cv/（gitignore済み）。LibreOffice があれば PDF に変換してページ数も表示する。
#   使い方: scripts/build-docx.sh [出力ファイル名]
set -euo pipefail

root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
reference="$root/templates/reference.docx"
# worktree で実行しても、本体のチェックアウトの .local/cv/ に出す（worktree を消しても残るように）
main_root="$(dirname "$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)")"
out_dir="$main_root/.local/cv"
out="$out_dir/${1:-業務経歴書_$(date +%Y%m%d).docx}"

if ! command -v pandoc >/dev/null; then
  echo "pandoc が見つかりません。" >&2
  exit 2
fi
if [[ ! -f "$reference" ]]; then
  echo "雛形がありません: scripts/make-reference-docx.py を実行してください。" >&2
  exit 2
fi

mkdir -p "$out_dir"
# 区切り線（---）は Word では余計な罫線になるため外し、見出しで区切る
# 表の列幅を区切り行の「-」の数から決めるため、pandoc の markdown として読み、--columns を小さくする
sed '/^---$/d' "$root/README.md" |
  pandoc --from markdown+autolink_bare_uris --to docx --columns 20 \
    --reference-doc "$reference" --output "$out"
echo "$out"

# ページ数の目安を LibreOffice で数える。Mac の LibreOffice は Windows / Office の
# 「Yu Gothic」を使えないため、確認用のコピーだけ文字幅の近いヒラギノ角ゴシックに置き換える
if command -v soffice >/dev/null; then
  work="$(mktemp -d)"
  preview="$work/preview.docx"
  python3 - "$out" "$preview" <<'PY'
import sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "word/styles.xml":
            data = data.replace(b'"Yu Gothic"', b'"Hiragino Sans"')
        zout.writestr(item, data)
PY
  # --headless では Mac のフォントを使えないため、macOS の描画方式で変換する
  SAL_USE_VCLPLUGIN=osx soffice --convert-to pdf --outdir "$work" "$preview" >/dev/null 2>&1
  if [[ -f "$work/preview.pdf" ]]; then
    echo "ページ数（A4、LibreOffice での目安）: $(grep -ac '/Type */Page[^s]' "$work/preview.pdf" || true)"
    if [[ -n "${CV_DOCX_KEEP_PREVIEW:-}" ]]; then
      cp "$work/preview.pdf" "${out%.docx}.preview.pdf"
      echo "${out%.docx}.preview.pdf"
    fi
  fi
  rm -rf "$work"
fi
