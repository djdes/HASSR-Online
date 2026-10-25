package ru.wesetup.helper.template;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.BeforeClass;
import org.junit.Test;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Line2D;
import java.awt.geom.Rectangle2D;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.TimeZone;

import javax.imageio.ImageIO;

import ru.wesetup.helper.print.LabelSettings;
import ru.wesetup.helper.print.MonoBitmap;
import ru.wesetup.helper.print.Tspl;

/**
 * Все шаблоны из assets — через ту же разметку, что на телефоне, но
 * шрифтами AWT: текст не вылезает за этикетку, поток TSPL собирается, а
 * PNG-превью и сам поток команд пробной этикетки кладутся в
 * {@code build/label-previews/} — на них видно, что напечатает принтер.
 */
public class LabelPreviewTest {

    private static final File OUT = new File("build/label-previews");

    @BeforeClass
    public static void headless() {
        System.setProperty("java.awt.headless", "true");
        //noinspection ResultOfMethodCallIgnored
        OUT.mkdirs();
    }

    /** Шрифты AWT вместо Paint Android: SansSerif с кириллицей. */
    static final class AwtMeasurer implements TextMeasurer {
        private final Graphics2D graphics = new BufferedImage(1, 1, BufferedImage.TYPE_INT_RGB).createGraphics();

        Font font(float sizePx, boolean bold) {
            return new Font(Font.SANS_SERIF, bold ? Font.BOLD : Font.PLAIN, 1).deriveFont(sizePx);
        }

        private FontMetrics metrics(float sizePx, boolean bold) {
            return graphics.getFontMetrics(font(sizePx, bold));
        }

        @Override
        public float width(String text, float sizePx, boolean bold) {
            return (float) metrics(sizePx, bold).getStringBounds(text, graphics).getWidth();
        }

        @Override
        public float ascent(float sizePx, boolean bold) {
            return metrics(sizePx, bold).getAscent();
        }

        @Override
        public float descent(float sizePx, boolean bold) {
            return metrics(sizePx, bold).getDescent();
        }
    }

    static BufferedImage draw(LabelLayout layout, AwtMeasurer measurer) {
        BufferedImage image = new BufferedImage(layout.widthDots, layout.heightDots, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setColor(Color.WHITE);
        g.fillRect(0, 0, layout.widthDots, layout.heightDots);
        for (DrawOp op : layout.ops) {
            if (op instanceof DrawOp.Rect) {
                DrawOp.Rect r = (DrawOp.Rect) op;
                g.setColor(Color.BLACK);
                if (r.fill) {
                    g.fill(new Rectangle2D.Float(r.left, r.top, r.right - r.left, r.bottom - r.top));
                } else {
                    float t = r.thickness;
                    g.fill(new Rectangle2D.Float(r.left, r.top, r.right - r.left, t));
                    g.fill(new Rectangle2D.Float(r.left, r.bottom - t, r.right - r.left, t));
                    g.fill(new Rectangle2D.Float(r.left, r.top, t, r.bottom - r.top));
                    g.fill(new Rectangle2D.Float(r.right - t, r.top, t, r.bottom - r.top));
                }
            } else if (op instanceof DrawOp.Line) {
                DrawOp.Line l = (DrawOp.Line) op;
                g.setColor(Color.BLACK);
                g.setStroke(new BasicStroke(l.thickness, BasicStroke.CAP_BUTT, BasicStroke.JOIN_MITER));
                g.draw(new Line2D.Float(l.x1, l.y1, l.x2, l.y2));
            } else if (op instanceof DrawOp.Text) {
                DrawOp.Text t = (DrawOp.Text) op;
                g.setColor(t.white ? Color.WHITE : Color.BLACK);
                g.setFont(measurer.font(t.sizePx, t.bold));
                g.drawString(t.text, t.x, t.baseline);
            }
        }
        g.dispose();
        return image;
    }

    /**
     * Значения для превью: общие + каждое поле шаблона. Длинные тексты —
     * нарочно: проверяем перенос и уменьшение шрифта, а не удачный пример.
     */
    private static TemplateValues sampleValues(LabelSettings settings, LabelTemplate template) {
        long now = 1792927800000L; // 25.10.2026 14:30 МСК
        TemplateValues values = baseValues(settings, now);
        for (TemplateField field : template.fields) {
            switch (field.type) {
                case DATETIME:
                    if (values.time(field.key) == null) values.time(field.key, TemplateValues.defaultTime(field.defaultValue, now));
                    break;
                case DURATION:
                    if (values.duration(field.key) == null) values.duration(field.key, Durations.parseMinutes(field.defaultValue));
                    break;
                default:
                    if (!values.text(field.key).isEmpty()) break;
                    String longest = "";
                    for (String option : field.options) if (option.length() > longest.length()) longest = option;
                    values.text(field.key, longest.isEmpty() ? values.resolve(field.defaultValue) : longest);
            }
        }
        return values;
    }

    private static TemplateValues baseValues(LabelSettings settings, long now) {
        return new TemplateValues(TimeZone.getTimeZone("Europe/Moscow"))
                .text("user.name", "Иван Петров")
                .text("org.name", "Кафе «Ромашка»")
                .text("printer.name", "IP-802BT")
                .text("printer.model", "AIYIN IP-802BT")
                .text("label.size", settings.sizeLabel())
                .text("app.version", "1.0.0")
                .time("now", now)
                .text("product", "Салат «Цезарь» с курицей и сухариками")
                .time("madeAt", now)
                .duration("shelfLife", 24 * 60)
                .time("openedAt", now)
                .duration("useWithin", 72 * 60)
                .text("employee", "Константинопольский Иван")
                .text("text", "Только для персонала\nНе трогать")
                .text("dish", "Суп-лапша куриная по-домашнему с зеленью")
                .text("amount", "20 шт.")
                .text("supplier", "ООО «Агрокомплекс Кубань»")
                .text("batch", "№ 12345/67 от 24.10.2026")
                .text("allergens", "Глютен, молоко, яйца, орехи, кунжут, сельдерей, горчица")
                .text("reason", "Нарушены условия хранения");
    }

    @Test
    public void testEveryBundledTemplateFitsTheLabelAndPrints() throws IOException {
        AwtMeasurer measurer = new AwtMeasurer();
        List<LabelTemplate> templates = TemplateParserTest.bundled();
        for (LabelTemplate template : templates) {
            for (int[] size : new int[][]{{58, 40}, {58, 30}, {40, 30}}) {
                LabelSettings settings = new LabelSettings();
                settings.widthMm = size[0];
                settings.heightMm = size[1];
                TemplateValues values = sampleValues(settings, template);
                LabelLayout layout = LayoutEngine.layout(template, settings, values, measurer);
                assertEquals(size[0] * 8, layout.widthDots);
                assertEquals(size[1] * 8, layout.heightDots);
                for (DrawOp op : layout.ops) {
                    if (!(op instanceof DrawOp.Text)) continue;
                    DrawOp.Text t = (DrawOp.Text) op;
                    float right = t.x + measurer.width(t.text, t.sizePx, t.bold);
                    String where = template.id + " " + settings.sizeLabel() + ": «" + t.text + "»";
                    assertTrue(where + " левее края", t.x >= -0.5f);
                    assertTrue(where + " правее края", right <= layout.widthDots + 0.5f);
                    assertTrue(where + " выше края", t.baseline - measurer.ascent(t.sizePx, t.bold) >= -0.5f);
                    assertTrue(where + " ниже края", t.baseline + measurer.descent(t.sizePx, t.bold) <= layout.heightDots + 0.5f);
                    assertTrue(where + ": остались скобки подстановки", !t.text.contains("{{"));
                }

                BufferedImage image = draw(layout, measurer);
                int[] pixels = image.getRGB(0, 0, image.getWidth(), image.getHeight(), null, 0, image.getWidth());
                MonoBitmap mono = MonoBitmap.fromArgb(pixels, image.getWidth(), image.getHeight(), 150);
                assertTrue(template.id + ": пустая этикетка", mono.blackCount() > 500);
                byte[] job = Tspl.labelJob(settings, mono, 1);
                assertTrue(job.length > mono.bytesPerRow * mono.height);

                BufferedImage printed = new BufferedImage(mono.width, mono.height, BufferedImage.TYPE_INT_ARGB);
                printed.setRGB(0, 0, mono.width, mono.height, mono.toArgb(), 0, mono.width);
                ImageIO.write(printed, "png", new File(OUT, template.id + "-" + size[0] + "x" + size[1] + ".png"));
                if (LabelTemplate.TEST_ID.equals(template.id) && size[0] == 58 && size[1] == 40) {
                    try (FileOutputStream out = new FileOutputStream(new File(OUT, "test-58x40.tspl"))) {
                        out.write(job);
                    }
                }
            }
        }
    }
}
