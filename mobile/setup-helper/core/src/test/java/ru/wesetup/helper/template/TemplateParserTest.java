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
        assertEquals(Arrays.asList("test-58x40", "product", "opened", "free-text"), ids);

        Set<String> context = new HashSet<>(Arrays.asList(
                "user.name", "org.name", "printer.name", "printer.model", "label.size", "app.version", "now"));
        Pattern placeholder = Pattern.compile("\\{\\{\\s*([A-Za-z0-9_.]+)(?:\\s*\\+\\s*([A-Za-z0-9_.]+))?");
        for (LabelTemplate t : templates) {
            assertEquals(58f, t.widthMm, 0f);
            assertEquals(40f, t.heightMm, 0f);
            assertFalse(t.elements.isEmpty());
            Set<String> known = new HashSet<>(context);
            for (TemplateField field : t.fields) known.add(field.key);
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
