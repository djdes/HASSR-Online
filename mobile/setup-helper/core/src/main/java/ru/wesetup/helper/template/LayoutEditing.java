package ru.wesetup.helper.template;

import java.util.ArrayList;
import java.util.List;

/**
 * Правила редактора макетов: попадание пальцем в элемент, перенос и размер
 * с шагом 0,5 мм в границах этикетки, новые элементы и вставки {@code {{…}}}.
 *
 * <p>Координаты — миллиметры шаблона. Чистая Java: проверяется тестами на JVM.
 */
public final class LayoutEditing {

    /** Шаг переноса и размера, мм. */
    public static final float STEP_MM = 0.5f;
    /** Меньше — элемент не ухватить пальцем и не прочитать на этикетке. */
    public static final float MIN_SIZE_MM = 2f;
    public static final float MIN_TEXT_SIZE_MM = 1.5f;
    public static final float MAX_TEXT_SIZE_MM = 20f;
    public static final float MIN_THICKNESS_MM = 0.15f;
    public static final float MAX_THICKNESS_MM = 3f;
    /** Линию, почти горизонтальную или вертикальную, выпрямляем: ровнее печать. */
    private static final float STRAIGHTEN_MM = 1f;

    private LayoutEditing() {
    }

    /** Двигается ли элемент: рамка и деления привязаны к краям этикетки. */
    public static boolean movable(TemplateElement e) {
        return e.type != TemplateElement.Type.FRAME && e.type != TemplateElement.Type.TICKS;
    }

    /** {left, top, right, bottom} элемента в мм шаблона. */
    public static float[] box(TemplateElement e, float labelW, float labelH) {
        switch (e.type) {
            case LINE:
                return new float[]{Math.min(e.x, e.x2), Math.min(e.y, e.y2), Math.max(e.x, e.x2), Math.max(e.y, e.y2)};
            case FRAME:
            case TICKS:
                return new float[]{e.inset, e.inset, labelW - e.inset, labelH - e.inset};
            default:
                return new float[]{e.x, e.y, e.x + e.w, e.y + e.h};
        }
    }

    /**
     * Какой элемент под пальцем: верхний (последний в списке) из попавших, или -1.
     * {@code slop} — запас вокруг элемента, мм (палец толще линии). Рамку и
     * деления берём только у края — иначе они перехватят любое нажатие.
     */
    public static int hit(List<TemplateElement> elements, float x, float y, float slop, float labelW, float labelH) {
        int frame = -1;
        for (int i = elements.size() - 1; i >= 0; i--) {
            TemplateElement e = elements.get(i);
            if (e.type == TemplateElement.Type.LINE) {
                if (distanceToSegment(x, y, e.x, e.y, e.x2, e.y2) <= slop + e.thickness / 2f) return i;
                continue;
            }
            float[] b = box(e, labelW, labelH);
            boolean inside = x >= b[0] - slop && x <= b[2] + slop && y >= b[1] - slop && y <= b[3] + slop;
            if (!inside) continue;
            if (movable(e)) return i;
            boolean nearEdge = x <= b[0] + slop || x >= b[2] - slop || y <= b[1] + slop || y >= b[3] - slop;
            if (nearEdge && frame < 0) frame = i;
        }
        return frame;
    }

    /** Попал ли палец в уголок размера выбранного элемента. */
    public static boolean hitHandle(TemplateElement e, float x, float y, float slop) {
        if (!movable(e)) return false;
        float hx = e.type == TemplateElement.Type.LINE ? e.x2 : e.x + e.w;
        float hy = e.type == TemplateElement.Type.LINE ? e.y2 : e.y + e.h;
        return Math.abs(x - hx) <= slop && Math.abs(y - hy) <= slop;
    }

    /**
     * Сдвиг от положения {@code start} на ({@code dx}, {@code dy}) мм с шагом
     * {@link #STEP_MM}: сам сдвиг округляется, а не координата — выравнивание
     * встроенных макетов (2,4 мм от края) не ломается. Элемент остаётся на этикетке.
     */
    public static void moveFrom(TemplateElement e, TemplateElement start, float dx, float dy,
                                float labelW, float labelH) {
        if (!movable(e)) return;
        float sx = snap(dx);
        float sy = snap(dy);
        if (e.type == TemplateElement.Type.LINE) {
            float minX = Math.min(start.x, start.x2);
            float maxX = Math.max(start.x, start.x2);
            float minY = Math.min(start.y, start.y2);
            float maxY = Math.max(start.y, start.y2);
            sx = clamp(sx, -minX, labelW - maxX);
            sy = clamp(sy, -minY, labelH - maxY);
            e.x = start.x + sx;
            e.x2 = start.x2 + sx;
            e.y = start.y + sy;
            e.y2 = start.y2 + sy;
            return;
        }
        e.x = clamp(start.x + sx, 0f, Math.max(0f, labelW - start.w));
        e.y = clamp(start.y + sy, 0f, Math.max(0f, labelH - start.h));
    }

    /** Сдвиг стрелками на один шаг. */
    public static void nudge(TemplateElement e, int stepsX, int stepsY, float labelW, float labelH) {
        moveFrom(e, e.copy(), stepsX * STEP_MM, stepsY * STEP_MM, labelW, labelH);
    }

    /**
     * Размер за уголок: ширина и высота (у линии — второй конец) от положения
     * {@code start}. Не меньше {@link #MIN_SIZE_MM} и не за краем этикетки.
     */
    public static void resizeFrom(TemplateElement e, TemplateElement start, float dx, float dy,
                                  float labelW, float labelH) {
        if (!movable(e)) return;
        if (e.type == TemplateElement.Type.LINE) {
            float x2 = clamp(start.x2 + snap(dx), 0f, labelW);
            float y2 = clamp(start.y2 + snap(dy), 0f, labelH);
            if (Math.abs(y2 - e.y) < STRAIGHTEN_MM) y2 = e.y;
            else if (Math.abs(x2 - e.x) < STRAIGHTEN_MM) x2 = e.x;
            e.x2 = x2;
            e.y2 = y2;
            return;
        }
        e.w = clamp(start.w + snap(dx), MIN_SIZE_MM, Math.max(MIN_SIZE_MM, labelW - e.x));
        e.h = clamp(start.h + snap(dy), MIN_SIZE_MM, Math.max(MIN_SIZE_MM, labelH - e.y));
    }

    /**
     * Новый размер этикетки: расположение растягивается по осям, шрифт — по
     * меньшей из них (буквы не сплющиваются), затем всё возвращается на этикетку.
     */
    public static void scaleTo(List<TemplateElement> elements, float oldW, float oldH, float newW, float newH) {
        float sx = newW / oldW;
        float sy = newH / oldH;
        float font = Math.min(sx, sy);
        for (TemplateElement e : elements) {
            if (!movable(e)) continue;
            e.x *= sx;
            e.x2 *= sx;
            e.w *= sx;
            e.y *= sy;
            e.y2 *= sy;
            e.h *= sy;
            e.size = clamp(e.size * font, MIN_TEXT_SIZE_MM, MAX_TEXT_SIZE_MM);
        }
        fitInto(elements, newW, newH);
    }

    /** Элементы, что вылезли за край этикетки, возвращаются на неё. */
    public static void fitInto(List<TemplateElement> elements, float labelW, float labelH) {
        for (TemplateElement e : elements) {
            if (!movable(e)) continue;
            if (e.type == TemplateElement.Type.LINE) {
                e.x = clamp(e.x, 0f, labelW);
                e.x2 = clamp(e.x2, 0f, labelW);
                e.y = clamp(e.y, 0f, labelH);
                e.y2 = clamp(e.y2, 0f, labelH);
                continue;
            }
            e.w = Math.min(e.w, labelW);
            e.h = Math.min(e.h, labelH);
            e.x = clamp(e.x, 0f, labelW - e.w);
            e.y = clamp(e.y, 0f, labelH - e.h);
        }
    }

    public static float textSize(float current, int steps) {
        return clamp(Math.round((current + steps * 0.2f) * 10f) / 10f, MIN_TEXT_SIZE_MM, MAX_TEXT_SIZE_MM);
    }

    public static float thickness(float current, int steps) {
        return clamp(Math.round((current + steps * 0.05f) * 100f) / 100f, MIN_THICKNESS_MM, MAX_THICKNESS_MM);
    }

    // --- Новые элементы: посередине этикетки, сразу видны и ухватываются пальцем.

    public static TemplateElement newText(String text, float labelW, float labelH) {
        TemplateElement e = new TemplateElement(TemplateElement.Type.TEXT);
        e.w = Math.max(MIN_SIZE_MM, labelW - 4.8f);
        e.h = Math.min(6f, labelH);
        e.x = (labelW - e.w) / 2f;
        e.y = (labelH - e.h) / 2f;
        e.text = text;
        e.size = 3.2f;
        e.valign = TemplateElement.VAlign.CENTER;
        return e;
    }

    /** Чёрная плашка с белым текстом — «РАЗМОРОЖЕНО», «БРАК». */
    public static TemplateElement newPlate(String text, float labelW, float labelH) {
        TemplateElement e = newText(text, labelW, labelH);
        e.invert = true;
        e.bold = true;
        e.align = TemplateElement.Align.CENTER;
        e.maxLines = 1;
        return e;
    }

    public static TemplateElement newLine(float labelW, float labelH) {
        TemplateElement e = new TemplateElement(TemplateElement.Type.LINE);
        e.x = 2.4f;
        e.x2 = Math.max(e.x + MIN_SIZE_MM, labelW - 2.4f);
        e.y = e.y2 = labelH / 2f;
        e.thickness = 0.3f;
        return e;
    }

    public static TemplateElement newRect(float labelW, float labelH) {
        TemplateElement e = new TemplateElement(TemplateElement.Type.RECT);
        e.w = Math.max(MIN_SIZE_MM, labelW / 2f);
        e.h = Math.max(MIN_SIZE_MM, labelH / 3f);
        e.x = (labelW - e.w) / 2f;
        e.y = (labelH - e.h) / 2f;
        e.thickness = 0.35f;
        e.radius = 1f;
        return e;
    }

    /**
     * Поставить новый элемент туда, где он ни на что не налезает: первая
     * свободная полоса сверху вниз с шагом {@link #STEP_MM}. Места нет — остаётся
     * где был (посередине), его передвинут пальцем.
     */
    public static void placeFree(List<TemplateElement> others, TemplateElement e, float labelW, float labelH) {
        if (!movable(e)) return;
        float[] own = box(e, labelW, labelH);
        float height = own[3] - own[1];
        // От рамки по краю — отступ, чтобы текст не лёг на её линию.
        float margin = STEP_MM;
        for (TemplateElement o : others) {
            if (!movable(o)) margin = Math.max(margin, o.inset + o.thickness + STEP_MM);
        }
        for (float y = margin; y + height <= labelH - margin + 0.001f; y += STEP_MM) {
            boolean free = true;
            for (TemplateElement o : others) {
                if (o == e || !movable(o)) continue;
                float[] b = box(o, labelW, labelH);
                // Линия занимает свою толщину, а не ноль.
                float pad = o.type == TemplateElement.Type.LINE ? Math.max(o.thickness, 0.3f) / 2f : 0f;
                boolean crossX = own[0] < b[2] + pad && own[2] > b[0] - pad;
                boolean crossY = y < b[3] + pad && y + height > b[1] - pad;
                if (crossX && crossY) {
                    free = false;
                    break;
                }
            }
            if (free) {
                float dy = y - own[1];
                e.y += dy;
                if (e.type == TemplateElement.Type.LINE) e.y2 += dy;
                return;
            }
        }
    }

    /** Вставка в текст: что пишется в макет и как это называется по-человечески. */
    public static final class Insert {
        public final String code;
        public final String title;

        Insert(String code, String title) {
            this.code = code;
            this.title = title;
        }
    }

    /**
     * Что можно вставить в текст: поля макета, «дата + срок» («годен до»)
     * и общие значения — подпись этикеток, время печати.
     */
    public static List<Insert> inserts(TemplateDraft d) {
        List<Insert> out = new ArrayList<>();
        for (TemplateDraft.Field f : d.fields) {
            switch (f.type) {
                case DATETIME:
                    if (f.dateOnly) {
                        out.add(new Insert("{{" + f.key + "|date}}", f.label));
                    } else {
                        out.add(new Insert("{{" + f.key + "|datetime}}", f.label));
                        out.add(new Insert("{{" + f.key + "|date}}", f.label + " — только дата"));
                    }
                    break;
                default:
                    out.add(new Insert("{{" + f.key + "}}", f.label));
            }
        }
        for (TemplateDraft.Field date : d.fields) {
            if (date.type != TemplateField.Type.DATETIME) continue;
            for (TemplateDraft.Field term : d.fields) {
                if (term.type != TemplateField.Type.DURATION) continue;
                out.add(new Insert("{{" + date.key + "+" + term.key + (date.dateOnly ? "|date}}" : "|datetime}}"),
                        "«" + date.label + "» + «" + term.label + "»"));
            }
        }
        out.add(new Insert("{{org.name}}", "Название заведения"));
        out.add(new Insert("{{org.site}}", "Подпись справа в шапке"));
        out.add(new Insert("{{user.name}}", "Ответственный по умолчанию"));
        out.add(new Insert("{{now|datetime}}", "Время печати"));
        out.add(new Insert("{{now|date}}", "Дата печати"));
        return out;
    }

    static float snap(float mm) {
        return Math.round(mm / STEP_MM) * STEP_MM;
    }

    static float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
    }

    private static float distanceToSegment(float px, float py, float x1, float y1, float x2, float y2) {
        float dx = x2 - x1;
        float dy = y2 - y1;
        float len2 = dx * dx + dy * dy;
        float t = len2 == 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0f, 1f);
        float cx = x1 + t * dx - px;
        float cy = y1 + t * dy - py;
        return (float) Math.sqrt(cx * cx + cy * cy);
    }
}
