# Таблицы первой страницы PDF по разметке (PyMuPDF find_tables) — независимая
# от кода печати проверка: какие колонки и в каком порядке реально напечатаны.
# Вход: пути к PDF. Выход (stdout): JSON {path: [{bbox, cols, rows: [[cell...]...]}]}.
import contextlib
import io
import json
import sys

import fitz  # PyMuPDF

out = {}
for path in sys.argv[1:]:
    doc = fitz.open(path)
    page = doc[0]
    tables = []
    # find_tables печатает в stdout совет про pymupdf_layout — глушим.
    with contextlib.redirect_stdout(io.StringIO()):
        found = page.find_tables().tables
    for table in found:
        # MuPDF не видит правую рамку таблицы у правого поля (287 мм): ячейки
        # последней графы обрезаются по ~281 мм, и «Примечание» читается как
        # «Примеча». Текст ячеек берём сами, последнюю графу расширяем до
        # правого поля листа (10 мм ≈ 28 pt).
        right = page.rect.width - 25
        rows = []
        for row in table.rows:
            texts = []
            for index, cell in enumerate(row.cells):
                if cell is None:
                    texts.append("")
                    continue
                rect = fitz.Rect(cell)
                if index == len(row.cells) - 1:
                    rect.x1 = max(rect.x1, right)
                # Строки ячейки склеиваем пробелом, а перенос после дефиса
                # («ветеринарно-» + «санитарной») — без пробела.
                text = ""
                for line in page.get_textbox(rect).split("\n"):
                    line = " ".join(line.split())
                    if not line:
                        continue
                    text = f"{text}{line}" if text.endswith("-") or not text else f"{text} {line}"
                texts.append(text)
            rows.append(texts)
        tables.append({
            "bbox": [round(v, 1) for v in table.bbox],
            "pageWidth": round(page.rect.width, 1),
            "cols": table.col_count,
            "rows": rows,
        })
    out[path] = {"pages": doc.page_count, "tables": tables}
sys.stdout.reconfigure(encoding="utf-8")
print(json.dumps(out, ensure_ascii=False))
