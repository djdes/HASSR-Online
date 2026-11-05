package ru.wesetup.helper.template;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.IOException;
import java.util.List;
import java.util.TimeZone;

import ru.wesetup.helper.print.LabelSettings;

/** Макет, изменённый на телефоне, сохраняется в JSON и открывается обратно без потерь. */
public class TemplateWriterTest {

    private static TemplateValues values() {
        long now = 1792927800000L;
        return new TemplateValues(TimeZone.getTimeZone("Europe/Moscow"))
                .text("org.name", "Кафе").text("org.site", "cafe.ru").text("user.name", "Иван")
                .text("product", "Салат").text("dish", "Суп").text("text", "Текст")
                .time("now", now).time("madeAt", now).duration("shelfLife", 24 * 60);
    }

    /** Разметка — точный отпечаток: совпала она, совпала и этикетка. */
    private static String fingerprint(LabelTemplate template) {
        LabelLayout layout = LayoutEngine.layout(template, new LabelSettings(), values(), LayoutEngineTest.MONO);
        StringBuilder out = new StringBuilder(layout.widthDots + "x" + layout.heightDots);
        for (DrawOp op : layout.ops) {
            if (op instanceof DrawOp.Text) {
                DrawOp.Text t = (DrawOp.Text) op;
                out.append("|T").append(t.text).append('@').append(t.x).append(',').append(t.baseline)
                        .append(',').append(t.sizePx).append(t.bold).append(t.white);
            } else if (op instanceof DrawOp.Line) {
                DrawOp.Line l = (DrawOp.Line) op;
                out.append("|L").append(l.x1).append(',').append(l.y1).append(',').append(l.x2).append(',')
                        .append(l.y2).append(',').append(l.thickness);
            } else if (op instanceof DrawOp.Rect) {
                DrawOp.Rect r = (DrawOp.Rect) op;
                out.append("|R").append(r.left).append(',').append(r.top).append(',').append(r.right).append(',')
                        .append(r.bottom).append(',').append(r.thickness).append(r.fill).append(r.radius);
            } else {
                out.append("|?");
            }
        }
        return out.toString();
    }

    @Test
    public void testEveryBundledTemplateSurvivesWriteAndParse() throws IOException {
        List<LabelTemplate> templates = TemplateParserTest.bundled();
        assertEquals(12, templates.size());
        for (LabelTemplate original : templates) {
            LabelTemplate copy = TemplateParser.parse(TemplateWriter.write(original));
            assertEquals(original.id, copy.id);
            assertEquals(original.title, copy.title);
            assertEquals(original.description, copy.description);
            assertEquals(original.fields.size(), copy.fields.size());
            for (int i = 0; i < original.fields.size(); i++) {
                TemplateField a = original.fields.get(i);
                TemplateField b = copy.fields.get(i);
                String where = original.id + "." + a.key;
                assertEquals(where, a.key, b.key);
                assertEquals(where, a.label, b.label);
                assertEquals(where, a.type, b.type);
                assertEquals(where, a.defaultValue, b.defaultValue);
                assertEquals(where, a.required, b.required);
                assertEquals(where, a.maxLength, b.maxLength);
                assertEquals(where, a.options, b.options);
                assertEquals(where, a.dateOnly, b.dateOnly);
                assertEquals(where, a.source, b.source);
                assertEquals(where, a.fillFrom, b.fillFrom);
            }
            assertEquals(original.id, original.record == null, copy.record == null);
            if (original.record != null) {
                assertEquals(original.record.item, copy.record.item);
                assertEquals(original.record.untilKey, copy.record.untilKey);
                assertEquals(original.record.untilPlus, copy.record.untilPlus);
                assertEquals(original.record.untilLabel, copy.record.untilLabel);
            }
            assertEquals(original.id, fingerprint(original), fingerprint(copy));
        }
    }

    @Test
    public void testDraftEditsBuildIntoATemplate() throws IOException {
        LabelTemplate product = byId("product");
        TemplateDraft draft = TemplateDraft.of(product);
        draft.title = "Маркировка — кухня";
        draft.elements.get(4).text = "{{product|upper}}";
        draft.elements.add(LayoutEditing.newPlate("НЕ ЗАМОРАЖИВАТЬ", draft.widthMm, draft.heightMm));
        TemplateDraft.Field batch = new TemplateDraft.Field(draft.newFieldKey(), "Партия", TemplateField.Type.TEXT);
        draft.fields.add(batch);

        LabelTemplate built = draft.build();
        assertEquals("Маркировка — кухня", built.title);
        assertEquals("{{product|upper}}", built.elements.get(4).text);
        assertTrue(built.elements.get(built.elements.size() - 1).invert);
        assertNotNull(built.field("field1"));
        assertNotNull("запись журнала на месте", built.record);
        // Исходный шаблон не тронут: правили копию.
        assertEquals("Маркировка продукта", product.title);
        assertEquals("{{product}}", product.elements.get(4).text);
    }

    @Test
    public void testRecordDropsWhenItsFieldIsRemoved() throws IOException {
        TemplateDraft draft = TemplateDraft.of(byId("product"));
        draft.fields.remove(draft.field("shelfLife"));
        LabelTemplate built = draft.build();
        assertNull(built.record);
        assertNull(built.field("shelfLife"));
    }

    @Test
    public void testDraftCopyIsIndependent() throws IOException {
        TemplateDraft draft = TemplateDraft.of(byId("product"));
        TemplateDraft snapshot = draft.copy();
        draft.elements.get(4).x += 5;
        draft.fields.get(0).label = "Изменено";
        draft.elements.remove(0);
        assertEquals(byId("product").elements.get(4).x, snapshot.elements.get(4).x, 0.0001f);
        assertEquals("Продукт", snapshot.fields.get(0).label);
        assertEquals(byId("product").elements.size(), snapshot.elements.size());
    }

    @Test
    public void testBrokenDraftIsRejected() throws IOException {
        TemplateDraft draft = TemplateDraft.of(byId("product"));
        draft.title = "  ";
        try {
            draft.build();
            fail("пустое название не должно пройти");
        } catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage(), expected.getMessage().contains("title"));
        }
        draft.title = "Ок";
        draft.fields.get(0).key = "1 плохой";
        try {
            draft.build();
            fail("плохой ключ поля не должен пройти");
        } catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage(), expected.getMessage().contains("Ключ поля"));
        }
    }

    @Test
    public void testNewFieldKeysAreUnique() {
        TemplateDraft draft = new TemplateDraft("my-1", "Мой", 58, 40);
        draft.fields.add(new TemplateDraft.Field(draft.newFieldKey(), "А", TemplateField.Type.TEXT));
        draft.fields.add(new TemplateDraft.Field(draft.newFieldKey(), "Б", TemplateField.Type.TEXT));
        assertEquals("field1", draft.fields.get(0).key);
        assertEquals("field2", draft.fields.get(1).key);
    }

    static LabelTemplate byId(String id) throws IOException {
        for (LabelTemplate t : TemplateParserTest.bundled()) {
            if (t.id.equals(id)) return t;
        }
        throw new AssertionError("нет шаблона " + id);
    }
}
