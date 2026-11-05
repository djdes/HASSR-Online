package ru.wesetup.helper.template;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class LayoutEditingTest {

    private static final float W = 58f;
    private static final float H = 40f;

    private static TemplateElement box(float x, float y, float w, float h) {
        TemplateElement e = new TemplateElement(TemplateElement.Type.TEXT);
        e.x = x;
        e.y = y;
        e.w = w;
        e.h = h;
        return e;
    }

    @Test
    public void testHitPicksTopmostAndSkipsFrameInside() {
        TemplateElement frame = new TemplateElement(TemplateElement.Type.FRAME);
        frame.inset = 0.8f;
        TemplateElement under = box(5, 5, 30, 10);
        TemplateElement over = box(10, 8, 10, 4);
        TemplateElement line = LayoutEditing.newLine(W, H);
        List<TemplateElement> all = Arrays.asList(frame, under, over, line);

        assertEquals("верхний из перекрытых", 2, LayoutEditing.hit(all, 12, 9, 1f, W, H));
        assertEquals(1, LayoutEditing.hit(all, 6, 6, 1f, W, H));
        assertEquals("линия с запасом под палец", 3, LayoutEditing.hit(all, 30, H / 2f + 0.9f, 1f, W, H));
        assertEquals("рамка — только у края", 0, LayoutEditing.hit(all, 1f, 30, 1f, W, H));
        assertEquals("пусто посередине рамки", -1, LayoutEditing.hit(all, 45, 30, 1f, W, H));
    }

    @Test
    public void testMoveSnapsTheDeltaAndStaysOnLabel() {
        TemplateElement e = box(2.4f, 8.6f, 20, 5);
        TemplateElement start = e.copy();
        LayoutEditing.moveFrom(e, start, 3.3f, 0.2f, W, H);
        assertEquals("сдвиг округлён до 0,5, а не координата", 5.9f, e.x, 0.001f);
        assertEquals(8.6f, e.y, 0.001f);

        LayoutEditing.moveFrom(e, start, 100f, 100f, W, H);
        assertEquals(W - 20, e.x, 0.001f);
        assertEquals(H - 5, e.y, 0.001f);
        LayoutEditing.moveFrom(e, start, -100f, -100f, W, H);
        assertEquals(0f, e.x, 0.001f);
        assertEquals(0f, e.y, 0.001f);
    }

    @Test
    public void testNudgeMovesHalfMillimetre() {
        TemplateElement e = box(10, 10, 5, 5);
        LayoutEditing.nudge(e, 1, -1, W, H);
        assertEquals(10.5f, e.x, 0.001f);
        assertEquals(9.5f, e.y, 0.001f);
    }

    @Test
    public void testLineMovesWholeAndResizeStraightens() {
        TemplateElement line = LayoutEditing.newLine(W, H);
        TemplateElement start = line.copy();
        LayoutEditing.moveFrom(line, start, 0, 30, W, H);
        assertEquals("оба конца на этикетке", H, Math.max(line.y, line.y2), 0.001f);
        assertEquals(line.y, line.y2, 0.001f);

        TemplateElement l2 = LayoutEditing.newLine(W, H);
        LayoutEditing.resizeFrom(l2, l2.copy(), -10, 0.6f, W, H);
        assertEquals("почти горизонтальная — выпрямлена", l2.y, l2.y2, 0.001f);
        assertEquals(W - 2.4f - 10, l2.x2, 0.001f);
    }

    @Test
    public void testResizeKeepsMinimumAndLabelEdge() {
        TemplateElement e = box(40, 30, 10, 5);
        LayoutEditing.resizeFrom(e, e.copy(), -50, -50, W, H);
        assertEquals(LayoutEditing.MIN_SIZE_MM, e.w, 0.001f);
        assertEquals(LayoutEditing.MIN_SIZE_MM, e.h, 0.001f);
        LayoutEditing.resizeFrom(e, e.copy(), 50, 50, W, H);
        assertEquals(W - 40, e.w, 0.001f);
        assertEquals(H - 30, e.h, 0.001f);
        assertTrue(LayoutEditing.hitHandle(e, 58, 40, 1f));
        assertFalse(LayoutEditing.hitHandle(e, 41, 31, 1f));
    }

    @Test
    public void testFrameDoesNotMove() {
        TemplateElement frame = new TemplateElement(TemplateElement.Type.FRAME);
        LayoutEditing.moveFrom(frame, frame.copy(), 5, 5, W, H);
        assertEquals(0f, frame.x, 0.001f);
        assertFalse(LayoutEditing.movable(frame));
    }

    @Test
    public void testFitIntoSmallerLabel() {
        List<TemplateElement> all = new ArrayList<>();
        all.add(box(40, 30, 15, 8));
        all.add(LayoutEditing.newLine(W, H));
        LayoutEditing.fitInto(all, 40, 30);
        TemplateElement e = all.get(0);
        assertTrue(e.x + e.w <= 40.001f);
        assertTrue(e.y + e.h <= 30.001f);
        assertTrue(all.get(1).x2 <= 40.001f);
    }

    @Test
    public void testScaleToKeepsProportionsAndFontReadable() {
        List<TemplateElement> all = new ArrayList<>();
        TemplateElement site = box(29, 1.9f, 26.6f, 5);
        site.size = 2.4f;
        all.add(site);
        all.add(LayoutEditing.newLine(W, H));
        LayoutEditing.scaleTo(all, W, H, 40, 30);
        assertEquals("правый край остаётся у правого края", 40 - (W - 55.6f) * 40 / W, site.x + site.w, 0.01f);
        assertEquals("шрифт по меньшей оси", 2.4f * 40 / W, site.size, 0.01f);
        assertTrue(all.get(1).x2 <= 40f);
    }

    @Test
    public void testPlaceFreeFindsAnEmptyStripe() {
        TemplateElement frame = new TemplateElement(TemplateElement.Type.FRAME);
        frame.inset = 0.8f;
        frame.thickness = 0.35f;
        List<TemplateElement> all = new ArrayList<>();
        all.add(frame);
        all.add(box(2, 2, 54, 10));
        TemplateElement fresh = LayoutEditing.newText("Партия", W, H);
        all.add(fresh);
        LayoutEditing.placeFree(all, fresh, W, H);
        assertTrue("ниже занятого", fresh.y >= 12f);
        assertTrue("не на рамке", fresh.y + fresh.h <= H - 0.8f);

        // Мест нет — остаётся где был.
        List<TemplateElement> full = new ArrayList<>();
        full.add(box(0, 0, W, H));
        TemplateElement squeezed = LayoutEditing.newText("x", W, H);
        float y = squeezed.y;
        full.add(squeezed);
        LayoutEditing.placeFree(full, squeezed, W, H);
        assertEquals(y, squeezed.y, 0.001f);
    }

    @Test
    public void testSizeAndThicknessSteps() {
        assertEquals(3.4f, LayoutEditing.textSize(3.2f, 1), 0.001f);
        assertEquals(LayoutEditing.MIN_TEXT_SIZE_MM, LayoutEditing.textSize(1.6f, -3), 0.001f);
        assertEquals(0.35f, LayoutEditing.thickness(0.3f, 1), 0.001f);
        assertEquals(LayoutEditing.MIN_THICKNESS_MM, LayoutEditing.thickness(0.2f, -5), 0.001f);
    }

    @Test
    public void testInsertsNameFieldsAndExpiryLikeTheBundledTemplate() throws IOException {
        TemplateDraft draft = TemplateDraft.of(TemplateWriterTest.byId("product"));
        List<String> codes = new ArrayList<>();
        for (LayoutEditing.Insert insert : LayoutEditing.inserts(draft)) codes.add(insert.code);
        assertTrue(codes.contains("{{product}}"));
        assertTrue(codes.contains("{{madeAt|datetime}}"));
        assertTrue("«годен до» — как во встроенном макете", codes.contains("{{madeAt+shelfLife|datetime}}"));
        assertTrue(codes.contains("{{org.name}}"));
        // Каждая вставка подставляется: на этикетке не остаётся «{{…}}».
        TemplateValues values = new TemplateValues(java.util.TimeZone.getTimeZone("UTC"))
                .text("product", "x").time("madeAt", 0).duration("shelfLife", 60).time("now", 0);
        for (String code : codes) assertFalse(code, values.resolve(code).contains("{{"));
    }
}
