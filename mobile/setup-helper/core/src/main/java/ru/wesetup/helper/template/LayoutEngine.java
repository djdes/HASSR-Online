package ru.wesetup.helper.template;

import java.util.ArrayList;
import java.util.List;

import ru.wesetup.helper.print.LabelSettings;

/**
 * Раскладка шаблона на этикетку: перенос строк, подбор кегля, выравнивание.
 *
 * <p>Шаблон нарисован под свой размер (например, 58×40 мм) и вписывается в
 * этикетку с сохранением пропорций, по центру. Сдвиг из настроек принтера
 * двигает всё вместе — так подгоняют картинку, если этикетка легла неровно
 * (команды {@code SHIFT} у IP-802BT нет).
 *
 * <p>Чистая Java без Android: те же правила проверяются тестами на JVM.
 */
public final class LayoutEngine {

    /** Межстрочный интервал в долях кегля. */
    static final float LINE_SPACING = 1.18f;
    private static final float SHRINK_STEP = 0.92f;
    private static final String ELLIPSIS = "…";

    private LayoutEngine() {
    }

    public static LabelLayout layout(LabelTemplate template, LabelSettings settings, TemplateValues values,
                                     TextMeasurer measurer) {
        LabelSettings s = settings.normalized();
        float dpm = LabelSettings.DOTS_PER_MM;
        float scale = Math.min(s.widthMm / template.widthMm, s.heightMm / template.heightMm);
        float offsetX = (s.widthMm - template.widthMm * scale) / 2f + s.shiftXmm;
        float offsetY = (s.heightMm - template.heightMm * scale) / 2f + s.shiftYmm;

        List<DrawOp> ops = new ArrayList<>();
        for (TemplateElement e : template.elements) {
            switch (e.type) {
                case TEXT: {
                    float left = (offsetX + e.x * scale) * dpm;
                    float top = (offsetY + e.y * scale) * dpm;
                    layoutText(ops, e, values.resolve(e.text), left, top, e.w * scale * dpm, e.h * scale * dpm,
                            e.size * scale * dpm, measurer);
                    break;
                }
                case LINE:
                    ops.add(new DrawOp.Line((offsetX + e.x * scale) * dpm, (offsetY + e.y * scale) * dpm,
                            (offsetX + e.x2 * scale) * dpm, (offsetY + e.y2 * scale) * dpm,
                            dots(e.thickness * scale)));
                    break;
                case RECT:
                    ops.add(new DrawOp.Rect((offsetX + e.x * scale) * dpm, (offsetY + e.y * scale) * dpm,
                            (offsetX + (e.x + e.w) * scale) * dpm, (offsetY + (e.y + e.h) * scale) * dpm,
                            dots(e.thickness * scale), e.fill, e.radius * scale * dpm));
                    break;
                case FRAME:
                    ops.add(new DrawOp.Rect((e.inset + s.shiftXmm) * dpm, (e.inset + s.shiftYmm) * dpm,
                            (s.widthMm - e.inset + s.shiftXmm) * dpm, (s.heightMm - e.inset + s.shiftYmm) * dpm,
                            dots(e.thickness), false, e.radius * dpm));
                    break;
                case TICKS:
                    addTicks(ops, e, s);
                    break;
                case IMAGE:
                    layoutImage(ops, e, values, (offsetX + e.x * scale) * dpm, (offsetY + e.y * scale) * dpm,
                            e.w * scale * dpm, e.h * scale * dpm, e.size * scale * dpm, measurer);
                    break;
                default:
                    break;
            }
        }
        return new LabelLayout(s.widthDots(), s.heightDots(), ops);
    }

    /**
     * Картинка вписывается в коробку с сохранением пропорций и прижимается по
     * {@code align}; нет картинки — в той же коробке печатается {@code fallbackText}.
     */
    private static void layoutImage(List<DrawOp> ops, TemplateElement e, TemplateValues values, float left, float top,
                                    float boxWidth, float boxHeight, float sizePx, TextMeasurer measurer) {
        int[] size = values.imageSize(e.src);
        if (size != null) {
            float fit = Math.min(boxWidth / size[0], boxHeight / size[1]);
            float width = size[0] * fit;
            float height = size[1] * fit;
            float x;
            switch (e.align) {
                case CENTER:
                    x = left + (boxWidth - width) / 2f;
                    break;
                case RIGHT:
                    x = left + boxWidth - width;
                    break;
                default:
                    x = left;
            }
            ops.add(new DrawOp.Image(e.src, x, top + (boxHeight - height) / 2f, width, height));
            return;
        }
        String fallback = values.resolve(e.fallbackText);
        if (!fallback.trim().isEmpty()) layoutText(ops, e, fallback, left, top, boxWidth, boxHeight, sizePx, measurer);
    }

    /** Деления от краёв этикетки через {@code step} мм, каждое второе длиннее. */
    private static void addTicks(List<DrawOp> ops, TemplateElement e, LabelSettings s) {
        float dpm = LabelSettings.DOTS_PER_MM;
        float thickness = dots(e.thickness);
        float top = e.inset + s.shiftYmm;
        float bottom = s.heightMm - e.inset + s.shiftYmm;
        float left = e.inset + s.shiftXmm;
        float right = s.widthMm - e.inset + s.shiftXmm;
        int index = 1;
        for (float mm = e.step; mm < s.widthMm - 0.01f; mm = e.step * ++index) {
            float length = index % 2 == 0 ? e.length * 1.6f : e.length;
            float x = (mm + s.shiftXmm) * dpm;
            ops.add(new DrawOp.Line(x, top * dpm, x, (top + length) * dpm, thickness));
            ops.add(new DrawOp.Line(x, bottom * dpm, x, (bottom - length) * dpm, thickness));
        }
        index = 1;
        for (float mm = e.step; mm < s.heightMm - 0.01f; mm = e.step * ++index) {
            float length = index % 2 == 0 ? e.length * 1.6f : e.length;
            float y = (mm + s.shiftYmm) * dpm;
            ops.add(new DrawOp.Line(left * dpm, y, (left + length) * dpm, y, thickness));
            ops.add(new DrawOp.Line(right * dpm, y, (right - length) * dpm, y, thickness));
        }
    }

    static void layoutText(List<DrawOp> ops, TemplateElement e, String text, float boxLeft, float boxTop,
                           float boxWidth, float boxHeight, float sizePx, TextMeasurer m) {
        if (e.invert) ops.add(new DrawOp.Rect(boxLeft, boxTop, boxLeft + boxWidth, boxTop + boxHeight, 0, true));
        if (text.trim().isEmpty() || sizePx <= 0) return;

        float padding = e.invert ? sizePx * 0.3f : 0f;
        float innerWidth = Math.max(1f, boxWidth - 2 * padding);
        float minSize = sizePx * Math.max(0.2f, Math.min(1f, e.minScale));
        float size = sizePx;
        List<String> lines;
        while (true) {
            lines = wrap(text, innerWidth, size, e.bold, m);
            boolean fits = lines.size() <= allowedLines(e, boxHeight, size, m)
                    && blockHeight(lines.size(), size, e.bold, m) <= boxHeight + 0.5f
                    && widest(lines, size, e.bold, m) <= innerWidth + 0.5f;
            if (fits || !e.fit || size <= minSize) break;
            size = Math.max(minSize, size * SHRINK_STEP);
        }
        int allowed = allowedLines(e, boxHeight, size, m);
        if (lines.size() > allowed) lines = truncate(lines, allowed, innerWidth, size, e.bold, m);

        float ascent = m.ascent(size, e.bold);
        float lineHeight = size * LINE_SPACING;
        float block = blockHeight(lines.size(), size, e.bold, m);
        float top;
        switch (e.valign) {
            case CENTER:
                top = boxTop + (boxHeight - block) / 2f;
                break;
            case BOTTOM:
                top = boxTop + boxHeight - block;
                break;
            default:
                top = boxTop;
        }
        for (int i = 0; i < lines.size(); i++) {
            String line = lines.get(i);
            float width = m.width(line, size, e.bold);
            float x;
            switch (e.align) {
                case CENTER:
                    x = boxLeft + (boxWidth - width) / 2f;
                    break;
                case RIGHT:
                    x = boxLeft + boxWidth - padding - width;
                    break;
                default:
                    x = boxLeft + padding;
            }
            ops.add(new DrawOp.Text(line, x, top + ascent + i * lineHeight, size, e.bold, e.invert));
        }
    }

    /** Перенос по словам; слово шире строки рвётся по буквам. Пустые строки выбрасываются. */
    static List<String> wrap(String text, float width, float size, boolean bold, TextMeasurer m) {
        List<String> lines = new ArrayList<>();
        for (String paragraph : text.split("\n")) {
            String current = "";
            for (String word : paragraph.trim().split("\\s+")) {
                if (word.isEmpty()) continue;
                String candidate = current.isEmpty() ? word : current + " " + word;
                if (m.width(candidate, size, bold) <= width) {
                    current = candidate;
                    continue;
                }
                if (!current.isEmpty()) lines.add(current);
                current = "";
                // Слово целиком не влезает — режем по буквам.
                while (m.width(word, size, bold) > width && word.length() > 1) {
                    int cut = word.length() - 1;
                    while (cut > 1 && m.width(word.substring(0, cut), size, bold) > width) cut--;
                    lines.add(word.substring(0, cut));
                    word = word.substring(cut);
                }
                current = word;
            }
            if (!current.isEmpty()) lines.add(current);
        }
        return lines;
    }

    private static List<String> truncate(List<String> lines, int allowed, float width, float size, boolean bold,
                                         TextMeasurer m) {
        List<String> kept = new ArrayList<>(lines.subList(0, Math.max(1, allowed)));
        int last = kept.size() - 1;
        String line = kept.get(last);
        while (!line.isEmpty() && m.width(line + ELLIPSIS, size, bold) > width) {
            line = line.substring(0, line.length() - 1).trim();
        }
        kept.set(last, line + ELLIPSIS);
        return kept;
    }

    private static int allowedLines(TemplateElement e, float boxHeight, float size, TextMeasurer m) {
        float single = m.ascent(size, e.bold) + m.descent(size, e.bold);
        int byHeight = Math.max(1, (int) Math.floor((boxHeight - single) / (size * LINE_SPACING) + 1e-3) + 1);
        return e.maxLines > 0 ? Math.min(e.maxLines, byHeight) : byHeight;
    }

    private static float blockHeight(int lineCount, float size, boolean bold, TextMeasurer m) {
        if (lineCount <= 0) return 0f;
        return (lineCount - 1) * size * LINE_SPACING + m.ascent(size, bold) + m.descent(size, bold);
    }

    private static float widest(List<String> lines, float size, boolean bold, TextMeasurer m) {
        float max = 0f;
        for (String line : lines) max = Math.max(max, m.width(line, size, bold));
        return max;
    }

    /** Миллиметры → точки, не тоньше одной точки. */
    private static float dots(float mm) {
        return Math.max(1f, mm * LabelSettings.DOTS_PER_MM);
    }
}
