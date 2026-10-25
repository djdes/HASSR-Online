package ru.wesetup.helper.template;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.TimeZone;

import ru.wesetup.helper.print.LabelSettings;

public class LayoutEngineTest {

    /** Моноширинный «шрифт»: каждая буква — половина кегля. Предсказуемо для проверок. */
    static final TextMeasurer MONO = new TextMeasurer() {
        @Override
        public float width(String text, float sizePx, boolean bold) {
            return text.length() * sizePx * 0.5f;
        }

        @Override
        public float ascent(float sizePx, boolean bold) {
            return sizePx * 0.8f;
        }

        @Override
        public float descent(float sizePx, boolean bold) {
            return sizePx * 0.2f;
        }
    };

    private static TemplateElement text(String value, float size) {
        TemplateElement e = new TemplateElement(TemplateElement.Type.TEXT);
        e.text = value;
        e.size = size;
        return e;
    }

    private static List<DrawOp.Text> texts(List<DrawOp> ops) {
        List<DrawOp.Text> result = new ArrayList<>();
        for (DrawOp op : ops) if (op instanceof DrawOp.Text) result.add((DrawOp.Text) op);
        return result;
    }

    @Test
    public void testWrapsByWordsAndBreaksLongWords() {
        // ширина 100 px, кегль 10 → 20 знаков в строке
        assertEquals(java.util.Arrays.asList("Салат Цезарь с", "курицей"),
                LayoutEngine.wrap("Салат Цезарь с курицей", 100, 10, false, MONO));
        assertEquals(java.util.Arrays.asList("ААААААААААААААААААAA", "ББ"),
                LayoutEngine.wrap("ААААААААААААААААААAAББ", 100, 10, false, MONO));
        assertEquals(java.util.Arrays.asList("раз", "два"), LayoutEngine.wrap("раз\n\n два ", 100, 10, false, MONO));
        assertEquals(Collections.emptyList(), LayoutEngine.wrap("   ", 100, 10, false, MONO));
    }

    @Test
    public void testFitShrinksTextUntilItFits() {
        TemplateElement e = text("", 10);
        e.maxLines = 1;
        List<DrawOp> ops = new ArrayList<>();
        // Кегль уменьшается, но не ниже 60 %.
        // 40 знаков: даже на минимальном кегле (6 px → 3 px на знак) это 120 px > 100 px.
        LayoutEngine.layoutText(ops, e, "абвгдеёжзийклмнопрстуфхцчшщъыьэюяабвгдеё", 0, 0, 100, 40, 10, MONO);
        List<DrawOp.Text> lines = texts(ops);
        assertEquals(1, lines.size());
        assertTrue(lines.get(0).sizePx < 10f);
        assertTrue(lines.get(0).sizePx >= 6f - 0.001f);
        // Даже на минимальном кегле не влезло — обрезано с многоточием в ширину блока.
        assertTrue(lines.get(0).text.endsWith("…"));
        assertTrue(MONO.width(lines.get(0).text, lines.get(0).sizePx, false) <= 100f);
    }

    @Test
    public void testNoFitTruncatesToMaxLines() {
        TemplateElement e = text("", 10);
        e.fit = false;
        e.maxLines = 2;
        List<DrawOp> ops = new ArrayList<>();
        LayoutEngine.layoutText(ops, e, "один два три четыре пять шесть семь восемь девять десять", 0, 0, 100, 100, 10, MONO);
        List<DrawOp.Text> lines = texts(ops);
        assertEquals(2, lines.size());
        assertEquals(10f, lines.get(0).sizePx, 0f);
        assertTrue(lines.get(1).text.endsWith("…"));
    }

    @Test
    public void testAlignmentAndVerticalCentering() {
        TemplateElement e = text("", 10);
        e.align = TemplateElement.Align.CENTER;
        e.valign = TemplateElement.VAlign.CENTER;
        List<DrawOp> ops = new ArrayList<>();
        LayoutEngine.layoutText(ops, e, "абв", 0, 0, 100, 100, 10, MONO);
        DrawOp.Text line = texts(ops).get(0);
        assertEquals((100 - 15) / 2f, line.x, 0.001f);
        // Высота строки 10 (8 + 2): центр по вертикали — верх на 45, базовая линия на 53.
        assertEquals(53f, line.baseline, 0.001f);

        e.align = TemplateElement.Align.RIGHT;
        e.valign = TemplateElement.VAlign.TOP;
        ops.clear();
        LayoutEngine.layoutText(ops, e, "абв", 10, 20, 100, 100, 10, MONO);
        line = texts(ops).get(0);
        assertEquals(10 + 100 - 15, line.x, 0.001f);
        assertEquals(28f, line.baseline, 0.001f);
    }

    @Test
    public void testInvertedTextDrawsPlateAndWhiteText() {
        TemplateElement e = text("", 10);
        e.invert = true;
        List<DrawOp> ops = new ArrayList<>();
        LayoutEngine.layoutText(ops, e, "ВСКРЫТО", 0, 0, 100, 20, 10, MONO);
        assertTrue(ops.get(0) instanceof DrawOp.Rect);
        assertTrue(((DrawOp.Rect) ops.get(0)).fill);
        assertTrue(texts(ops).get(0).white);
    }

    @Test
    public void testTemplateScalesToLabelAndFrameUsesRealLabelEdges() {
        List<TemplateElement> elements = new ArrayList<>();
        TemplateElement frame = new TemplateElement(TemplateElement.Type.FRAME);
        frame.inset = 1f;
        frame.thickness = 0.25f;
        elements.add(frame);
        TemplateElement line = new TemplateElement(TemplateElement.Type.LINE);
        line.x = 0;
        line.y = 20;
        line.x2 = 58;
        line.y2 = 20;
        elements.add(line);
        LabelTemplate template = new LabelTemplate("t", "T", "", 58, 40,
                Collections.<TemplateField>emptyList(), elements);

        LabelSettings settings = new LabelSettings();
        settings.widthMm = 58;
        settings.heightMm = 30; // ниже шаблона: масштаб 0.75, по центру по ширине
        LabelLayout layout = LayoutEngine.layout(template, settings, new TemplateValues(TimeZone.getDefault()), MONO);
        assertEquals(464, layout.widthDots);
        assertEquals(240, layout.heightDots);

        DrawOp.Rect rect = (DrawOp.Rect) layout.ops.get(0);
        assertEquals(8f, rect.left, 0.001f);
        assertEquals(8f, rect.top, 0.001f);
        assertEquals(456f, rect.right, 0.001f);
        assertEquals(232f, rect.bottom, 0.001f);
        assertEquals(2f, rect.thickness, 0.001f);

        DrawOp.Line l = (DrawOp.Line) layout.ops.get(1);
        float offsetX = (58 - 58 * 0.75f) / 2f;
        assertEquals(offsetX * 8, l.x1, 0.001f);
        assertEquals((offsetX + 58 * 0.75f) * 8, l.x2, 0.001f);
        assertEquals(20 * 0.75f * 8, l.y1, 0.001f);
        assertEquals(0.3f * 0.75f * 8, l.thickness, 0.001f); // толщина масштабируется вместе с шаблоном
    }

    @Test
    public void testShiftMovesEverything() {
        List<TemplateElement> elements = new ArrayList<>();
        TemplateElement frame = new TemplateElement(TemplateElement.Type.FRAME);
        frame.inset = 0f;
        elements.add(frame);
        LabelTemplate template = new LabelTemplate("t", "T", "", 58, 40,
                Collections.<TemplateField>emptyList(), elements);
        LabelSettings settings = new LabelSettings();
        settings.shiftXmm = 1f;
        settings.shiftYmm = -0.5f;
        DrawOp.Rect rect = (DrawOp.Rect) LayoutEngine.layout(template, settings,
                new TemplateValues(TimeZone.getDefault()), MONO).ops.get(0);
        assertEquals(8f, rect.left, 0.001f);
        assertEquals(-4f, rect.top, 0.001f);
    }

    @Test
    public void testTicksEveryStepWithLongerEvenTicks() {
        List<TemplateElement> elements = new ArrayList<>();
        TemplateElement ticks = new TemplateElement(TemplateElement.Type.TICKS);
        ticks.inset = 0f;
        ticks.step = 5f;
        ticks.length = 1f;
        elements.add(ticks);
        LabelTemplate template = new LabelTemplate("t", "T", "", 58, 40,
                Collections.<TemplateField>emptyList(), elements);
        LabelLayout layout = LayoutEngine.layout(template, new LabelSettings(),
                new TemplateValues(TimeZone.getDefault()), MONO);
        // По ширине 58 мм: 5…55 — 11 отметок сверху и снизу; по высоте 40 мм: 5…35 — 7 слева и справа.
        assertEquals(11 * 2 + 7 * 2, layout.ops.size());
        DrawOp.Line first = (DrawOp.Line) layout.ops.get(0);
        DrawOp.Line second = (DrawOp.Line) layout.ops.get(2);
        assertEquals(40f, first.x1, 0.001f);
        assertEquals(8f, first.y2 - first.y1, 0.001f);
        assertEquals(80f, second.x1, 0.001f);
        assertEquals(12.8f, second.y2 - second.y1, 0.001f);
    }
}
