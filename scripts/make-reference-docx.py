#!/usr/bin/env python3
"""提出用 Word の見た目を決める雛形（templates/reference.docx）を作る。

pandoc 既定の雛形を元に、A4・余白 20mm・游ゴシック 10pt・日本語の言語設定に変える。
見た目を変えたいときはこのスクリプトを直して再実行し、生成物もコミットする。
"""
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "templates" / "reference.docx"

FONT = "Yu Gothic"  # Windows / macOS の Word に標準で入っている游ゴシック
BODY_HALF_POINTS = 20  # 10pt
HEADING_HALF_POINTS = {"Title": 32, "Heading1": 30, "Heading2": 26, "Heading3": 23, "Heading4": 21}
# 段落の前後の間隔（twip）。A4 3〜4 枚に収めるため、pandoc 既定より詰める
SPACING = {
    "BodyText": (0, 100),
    "Compact": (0, 0),
    "Heading1": (240, 60),
    "Heading2": (200, 60),
    "Heading3": (160, 40),
    "Heading4": (80, 20),
}
# A4（twip）と余白 20mm
SECT_PR = (
    "<w:sectPr>"
    '<w:footnotePr><w:numRestart w:val="eachSect" /></w:footnotePr>'
    '<w:pgSz w:w="11906" w:h="16838" />'
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" '
    'w:header="567" w:footer="567" w:gutter="0" />'
    "</w:sectPr>"
)


def replace_once(pattern: str, repl: str, text: str) -> str:
    new, n = re.subn(pattern, repl, text, count=1, flags=re.S)
    if n != 1:
        sys.exit(f"雛形の構造が想定と違います: {pattern}")
    return new


def patch_styles(xml: str) -> str:
    fonts = f'<w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}" w:eastAsia="{FONT}" w:cs="{FONT}" />'
    xml = replace_once(r"(<w:rPrDefault>.*?)<w:rFonts [^>]*/>", rf"\g<1>{fonts}", xml)
    xml = replace_once(
        r'(<w:rPrDefault>.*?)<w:sz w:val="\d+" />\s*<w:szCs w:val="\d+" />',
        rf'\g<1><w:sz w:val="{BODY_HALF_POINTS}" /><w:szCs w:val="{BODY_HALF_POINTS}" />',
        xml,
    )
    xml = replace_once(r'(<w:rPrDefault>.*?<w:lang [^>]*?)w:eastAsia="[^"]*"', r'\g<1>w:eastAsia="ja-JP"', xml)
    xml = replace_once(
        r'(<w:pPrDefault>.*?)<w:spacing w:after="\d+" />',
        r'\g<1><w:spacing w:after="80" w:line="240" w:lineRule="auto" />',
        xml,
    )
    for style_id, (before, after) in SPACING.items():
        xml = replace_once(
            rf'(<w:style [^>]*w:styleId="{style_id}".*?)<w:spacing w:before="\d+" w:after="\d+" />',
            rf'\g<1><w:spacing w:before="{before}" w:after="{after}" />',
            xml,
        )
    # 見出しのフォントもテーマから游ゴシックに固定する
    xml = re.sub(r'<w:rFonts w:asciiTheme="majorHAnsi"[^>]*/>', fonts, xml)
    for style_id, size in HEADING_HALF_POINTS.items():
        xml = replace_once(
            rf'(<w:style [^>]*w:styleId="{style_id}".*?)(</w:rPr>)',
            rf'\g<1><w:sz w:val="{size}" /><w:szCs w:val="{size}" />\g<2>',
            re.sub(
                rf'(<w:style [^>]*w:styleId="{style_id}".*?)<w:sz w:val="\d+" />(\s*<w:szCs w:val="\d+" />)?',
                r"\g<1>",
                xml,
                count=1,
                flags=re.S,
            ),
        )
    return xml


def patch_document(xml: str) -> str:
    return replace_once(r"<w:sectPr>.*?</w:sectPr>", SECT_PR, xml)


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp) / "default.docx"
        subprocess.run(["pandoc", "-o", str(base), "--print-default-data-file", "reference.docx"], check=True)
        OUT.parent.mkdir(exist_ok=True)
        with zipfile.ZipFile(base) as src, zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as dst:
            for item in src.infolist():
                data = src.read(item.filename)
                if item.filename == "word/styles.xml":
                    data = patch_styles(data.decode()).encode()
                elif item.filename == "word/document.xml":
                    data = patch_document(data.decode()).encode()
                dst.writestr(item, data)
    print(OUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
