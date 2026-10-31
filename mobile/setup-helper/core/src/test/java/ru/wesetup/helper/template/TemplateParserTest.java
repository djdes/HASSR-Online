package ru.wesetup.helper.template;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class TemplateParserTest {

    /** Шаблоны из assets приложения — те же файлы, что попадут в APK. */
    static List<LabelTemplate> bundled() throws IOException {
        File folder = new File("../app/src/main/assets/templates");
        File[] files = folder.listFiles((dir, name) -> name.endsWith(".json"));
        assertNotNull("Нет папки шаблонов " + folder.getAbsolutePath(), files);
        Arrays.sort(files);
        List<LabelTemplate> templates = new ArrayList<>();
        for (File file : files) {
            templates.add(TemplateParser.parse(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)));
        }
        return templates;
    }

    @Test
    public void testBundledTemplatesParseAndReferenceOnlyKnownValues() throws IOException {
        List<LabelTemplate> templates = bundled();
        List<String> ids = new ArrayList<>();
        for (LabelTemplate t : templates) ids.add(t.id);
        assertEquals(Arrays.asList("test-58x40", "product", "semi-finished", "dish", "defrost", "freeze",
                "daily-sample", "incoming", "allergens", "reject", "opened", "free-text"), ids);

        Set<String> context = new HashSet<>(Arrays.asList(
                "user.name", "org.name", "org.site", "printer.name", "printer.model", "label.size", "app.version", "now"));
        Pattern placeholder = Pattern.compile("\\{\\{\\s*([A-Za-z0-9_.]+)(?:\\s*\\+\\s*([A-Za-z0-9_.]+))?");
        for (LabelTemplate t : templates) {
            assertEquals(58f, t.widthMm, 0f);
            assertEquals(40f, t.heightMm, 0f);
            assertFalse(t.elements.isEmpty());
            Set<String> known = new HashSet<>(context);
            for (TemplateField field : t.fields) known.add(field.key);
            assertBrandedHeader(t);
            for (TemplateElement e : t.elements) {
                if (e.type != TemplateElement.Type.TEXT) continue;
                assertTrue(t.id + ": текст вне шаблона " + e.text, e.x >= 0 && e.y >= 0
                        && e.x + e.w <= t.widthMm + 0.01f && e.y + e.h <= t.heightMm + 0.01f);
                Matcher m = placeholder.matcher(e.text);
                while (m.find()) {
                    assertTrue(t.id + ": неизвестное значение " + m.group(1), known.contains(m.group(1)));
                    if (m.group(2) != null) {
                        TemplateField duration = t.field(m.group(2));
                        assertNotNull(t.id + ": нет срока " + m.group(2), duration);
                        assertEquals(TemplateField.Type.DURATION, duration.type);
                    }
                }
            }
        }
        LabelTemplate product = templates.get(1);
        assertTrue(product.field("product").required);
        assertEquals(TemplateField.Type.DATETIME, product.field("madeAt").type);
        assertEquals("24h", product.field("shelfLife").defaultValue);
        assertEquals("{{user.name}}", product.field("employee").defaultValue);

        // Пищевое производство: умолчания, варианты и дата без времени.
        LabelTemplate sample = byId(templates, "daily-sample");
        assertEquals("48h", sample.field("keepFor").defaultValue);
        assertEquals("Обед", sample.field("meal").defaultValue);
        assertTrue(sample.field("meal").options.contains("Полдник"));
        LabelTemplate semi = byId(templates, "semi-finished");
        assertEquals(TemplateField.Type.TEXT, semi.field("storage").type);
        assertEquals("+2…+6 °C", semi.field("storage").defaultValue);
        LabelTemplate incoming = byId(templates, "incoming");
        assertTrue(incoming.field("expiresAt").dateOnly);
        assertTrue(incoming.field("receivedAt").dateOnly);
        assertFalse(byId(templates, "dish").field("cookedAt").dateOnly);
        for (LabelTemplate t : templates) {
            for (TemplateField field : t.fields) {
                if (field.type == TemplateField.Type.TEXT && field.defaultValue.startsWith("{{")) continue;
                if (field.type == TemplateField.Type.TEXT && !field.options.isEmpty() && !field.defaultValue.isEmpty()) {
                    assertTrue(t.id + "." + field.key + ": умолчание из вариантов", field.options.contains(field.defaultValue));
                }
            }
        }
    }

    /**
     * Фирменная шапка: скруглённая рамка, логотип слева (с названием вместо него),
     * сайт справа, линия под ними; всё содержимое лежит внутри рамки.
     */
    private static void assertBrandedHeader(LabelTemplate t) {
        TemplateElement frame = null;
        TemplateElement image = null;
        boolean site = false;
        for (TemplateElement e : t.elements) {
            if (e.type == TemplateElement.Type.FRAME) frame = e;
            if (e.type == TemplateElement.Type.IMAGE) image = e;
            if (e.type == TemplateElement.Type.TEXT && e.text.contains("{{org.site}}")) site = true;
        }
        assertNotNull(t.id + ": нет рамки", frame);
        assertTrue(t.id + ": рамка без скругления", frame.radius >= 1.5f);
        assertNotNull(t.id + ": нет логотипа в шапке", image);
        assertEquals("org.logo", image.src);
        assertTrue(t.id + ": у логотипа нет запасного текста с названием", image.fallbackText.contains("{{org.name}}"));
        assertTrue(t.id + ": нет сайта в шапке", site);
        // Внутренний край рамки (inset + толщина) в миллиметрах шаблона 58x40.
        float edge = frame.inset + frame.thickness;
        for (TemplateElement e : t.elements) {
            if (e.type == TemplateElement.Type.LINE) {
                assertTrue(t.id + ": линия вне рамки", Math.min(e.x, e.x2) >= edge - 0.01f
                        && Math.max(e.x, e.x2) <= t.widthMm - edge + 0.01f
                        && Math.min(e.y, e.y2) >= edge - 0.01f && Math.max(e.y, e.y2) <= t.heightMm - edge + 0.01f);
            } else if (e.type == TemplateElement.Type.TEXT || e.type == TemplateElement.Type.IMAGE) {
                assertTrue(t.id + ": элемент вне рамки " + e.text + e.src, e.x >= edge - 0.01f && e.y >= edge - 0.01f
                        && e.x + e.w <= t.widthMm - edge + 0.01f && e.y + e.h <= t.heightMm - edge + 0.01f);
                if (e.type == TemplateElement.Type.TEXT && !e.text.contains("{{org.site}}")) {
                    assertTrue(t.id + ": " + e.text + " налезает на шапку", e.y >= 7.6f);
                }
            }
        }
    }

    @Test
    public void testParsesImageAndRadius() {
        LabelTemplate t = TemplateParser.parse("{\"id\":\"x\",\"title\":\"X\",\"size\":{\"width\":58,\"height\":40},"
                + "\"elements\":[{\"type\":\"image\",\"src\":\"org.logo\",\"x\":1,\"y\":2,\"w\":20,\"h\":5,"
                + "\"align\":\"right\",\"fallbackText\":\"{{org.name}}\"},"
                + "{\"type\":\"frame\",\"radius\":2},{\"type\":\"rect\",\"w\":5,\"h\":5,\"radius\":1.5}]}");
        TemplateElement image = t.elements.get(0);
        assertEquals(TemplateElement.Type.IMAGE, image.type);
        assertEquals("org.logo", image.src);
        assertEquals(TemplateElement.Align.RIGHT, image.align);
        assertEquals("{{org.name}}", image.fallbackText);
        assertEquals(2f, t.elements.get(1).radius, 0f);
        assertEquals(1.5f, t.elements.get(2).radius, 0f);
    }

    @Test
    public void testImageNeedsSizeAndKey() {
        for (String element : new String[]{
                "{\"type\":\"image\",\"src\":\"org.logo\",\"w\":0,\"h\":5}",
                "{\"type\":\"image\",\"src\":\"\",\"w\":5,\"h\":5}"}) {
            try {
                TemplateParser.parse("{\"id\":\"x\",\"title\":\"X\",\"size\":{\"width\":58,\"height\":40},"
                        + "\"elements\":[" + element + "]}");
                fail("Картинка без размера или ключа должна отклоняться");
            } catch (IllegalArgumentException expected) {
                // так и задумано
            }
        }
    }

    private static LabelTemplate byId(List<LabelTemplate> templates, String id) {
        for (LabelTemplate t : templates) if (t.id.equals(id)) return t;
        throw new AssertionError("Нет шаблона " + id);
    }

    @Test
    public void testInvalidTemplatesAreRejectedWithReason() {
        expectError("{}", "не разобран");
        expectError("{\"id\":\"Bad Id\",\"title\":\"x\",\"size\":{\"width\":58,\"height\":40},\"elements\":[]}", "Код шаблона");
        expectError("{\"id\":\"x\",\"title\":\"x\",\"size\":{\"width\":0,\"height\":40},\"elements\":[]}", "Размер");
        expectError("{\"id\":\"x\",\"title\":\"x\",\"size\":{\"width\":58,\"height\":40},\"elements\":[{\"type\":\"circle\"}]}", "Неизвестный элемент");
        expectError("{\"id\":\"x\",\"title\":\"x\",\"size\":{\"width\":58,\"height\":40},\"elements\":[{\"type\":\"text\",\"text\":\"a\"}]}", "ширина и высота");
        expectError("{\"id\":\"x\",\"title\":\"x\",\"size\":{\"width\":58,\"height\":40},\"fields\":[{\"key\":\"a\",\"label\":\"A\",\"type\":\"duration\",\"default\":\"soon\"}],\"elements\":[]}", "Срок по умолчанию");
        expectError("{\"id\":\"x\",\"title\":\"x\",\"size\":{\"width\":58,\"height\":40},\"fields\":[{\"key\":\"a\",\"label\":\"A\",\"type\":\"color\"}],\"elements\":[]}", "Неизвестный тип поля");
        expectError("{\"id\":\"x\",\"title\":\"x\",\"size\":{\"width\":58,\"height\":40},\"fields\":[{\"key\":\"a\",\"label\":\"A\",\"type\":\"text\",\"maxLength\":5,\"options\":[\"слишком длинный\"]}],\"elements\":[]}", "длиннее 5");
        expectError("{\"id\":\"x\",\"title\":\"x\",\"size\":{\"width\":58,\"height\":40},\"fields\":[{\"key\":\"a\",\"label\":\"A\",\"type\":\"datetime\",\"options\":[\"now\"]}],\"elements\":[]}", "вариантов не бывает");
        expectError("{\"id\":\"x\",\"title\":\"x\",\"size\":{\"width\":58,\"height\":40},\"fields\":[{\"key\":\"a\",\"label\":\"A\",\"type\":\"text\",\"dateOnly\":true}],\"elements\":[]}", "только у даты");
        expectError("{\"id\":\"x\",\"title\":\"x\",\"size\":{\"width\":58,\"height\":40},\"fields\":[{\"key\":\"a\",\"label\":\"A\",\"type\":\"duration\",\"default\":\"2h\",\"options\":[\"Обед\"]}],\"elements\":[]}", "Срок «Обед»");
    }

    @Test
    public void testMarkingTemplatesReportToTheSiteAndTakeHintsFromCatalog() throws IOException {
        List<LabelTemplate> templates = bundled();
        // Пробная этикетка и произвольный текст — не маркировка: в журнал не идут.
        assertEquals(null, byId(templates, "test-58x40").record);
        assertEquals(null, byId(templates, "free-text").record);
        for (LabelTemplate t : templates) {
            if (t.record == null) continue;
            TemplateField item = t.field(t.record.item);
            assertEquals(t.id, TemplateField.Type.TEXT, item.type);
            assertTrue(t.id + ": у «что» нет подсказок из справочника", !item.source.isEmpty());
            assertEquals(t.id, "staff", t.field(t.record.by).source);
        }
        RecordSpec semi = byId(templates, "semi-finished").record;
        assertEquals("madeAt", semi.start);
        assertEquals("madeAt", semi.untilKey);
        assertEquals("shelfLife", semi.untilPlus);
        assertEquals("Годен до", semi.untilLabel);
        assertEquals("shelfLife", byId(templates, "semi-finished").field("shelfLife").fillFrom);
        assertEquals("storage", byId(templates, "semi-finished").field("storage").fillFrom);
        RecordSpec incoming = byId(templates, "incoming").record;
        assertEquals("expiresAt", incoming.untilKey);
        assertEquals("", incoming.untilPlus);
        assertEquals("supplier", byId(templates, "incoming").field("supplier").fillFrom);
        assertEquals("suppliers", byId(templates, "incoming").field("supplier").source);
        assertEquals("", byId(templates, "reject").record.untilKey);
        assertEquals("dishes", byId(templates, "daily-sample").field("dish").source);
    }

    @Test
    public void testCatalogHintsAndRecordAreValidated() {
        String head = "{\"id\":\"x\",\"title\":\"x\",\"size\":{\"width\":58,\"height\":40},\"elements\":[],\"fields\":[";
        String fields = "{\"key\":\"product\",\"label\":\"Продукт\",\"type\":\"text\"},"
                + "{\"key\":\"madeAt\",\"label\":\"Изготовлено\",\"type\":\"datetime\"},"
                + "{\"key\":\"shelf\",\"label\":\"Срок\",\"type\":\"duration\",\"default\":\"24h\"}";
        expectError(head + "{\"key\":\"a\",\"label\":\"A\",\"type\":\"text\",\"source\":\"recipes\"}]}", "Справочник «recipes»");
        expectError(head + "{\"key\":\"a\",\"label\":\"A\",\"type\":\"duration\",\"default\":\"2h\",\"source\":\"products\"}]}", "только у текста");
        expectError(head + "{\"key\":\"a\",\"label\":\"A\",\"type\":\"text\",\"fillFrom\":\"shelfLife\"}]}", "не подходит");
        expectError(head + "{\"key\":\"a\",\"label\":\"A\",\"type\":\"duration\",\"default\":\"2h\",\"fillFrom\":\"storage\"}]}", "не подходит");
        expectError(head + fields + "],\"record\":{\"item\":\"madeAt\"}}", "record.item");
        expectError(head + fields + "],\"record\":{\"item\":\"product\",\"until\":\"madeAt+product\",\"untilLabel\":\"Годен до\"}}", "record.until");
        expectError(head + fields + "],\"record\":{\"item\":\"product\",\"until\":\"madeAt+shelf\"}}", "untilLabel");
        expectError(head + fields + "],\"record\":{\"item\":\"product\",\"by\":\"shelf\"}}", "record.by");
        LabelTemplate ok = TemplateParser.parse(head + fields
                + "],\"record\":{\"item\":\"product\",\"start\":\"madeAt\",\"until\":\"madeAt + shelf\",\"untilLabel\":\"Годен до\"}}");
        assertEquals("madeAt", ok.record.untilKey);
        assertEquals("shelf", ok.record.untilPlus);
        assertEquals("", ok.record.by);
    }

    private static void expectError(String json, String fragment) {
        try {
            TemplateParser.parse(json);
            fail("Шаблон должен быть отклонён: " + json);
        } catch (IllegalArgumentException e) {
            assertTrue(e.getMessage() + " ≠ " + fragment, e.getMessage().contains(fragment));
        }
    }
}
