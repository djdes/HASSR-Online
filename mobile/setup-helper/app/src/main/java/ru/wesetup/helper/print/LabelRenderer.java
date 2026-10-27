package ru.wesetup.helper.print;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;

import java.util.Collections;
import java.util.Map;

import ru.wesetup.helper.template.DrawOp;
import ru.wesetup.helper.template.LabelLayout;
import ru.wesetup.helper.template.TextMeasurer;

/**
 * Рисует разложенную этикетку на Android и превращает её в картинку для
 * принтера. Текст — шрифтом телефона (Roboto, кириллица есть всегда),
 * сглаживание включено, а порог 150 из 255 делает буквы чуть плотнее —
 * термопечать любит жирнее.
 */
public final class LabelRenderer {

    static final int THRESHOLD = 150;

    private LabelRenderer() {
    }

    /** Измерение текста тем же шрифтом, которым рисуем. */
    public static final class AndroidMeasurer implements TextMeasurer {
        private final Paint regular = paint(false);
        private final Paint bold = paint(true);

        @Override
        public synchronized float width(String text, float sizePx, boolean isBold) {
            Paint p = isBold ? bold : regular;
            p.setTextSize(sizePx);
            return p.measureText(text);
        }

        @Override
        public synchronized float ascent(float sizePx, boolean isBold) {
            Paint p = isBold ? bold : regular;
            p.setTextSize(sizePx);
            return -p.getFontMetrics().ascent;
        }

        @Override
        public synchronized float descent(float sizePx, boolean isBold) {
            Paint p = isBold ? bold : regular;
            p.setTextSize(sizePx);
            return p.getFontMetrics().descent;
        }
    }

    public static Bitmap draw(LabelLayout layout) {
        return draw(layout, Collections.<String, Bitmap>emptyMap());
    }

    /**
     * {@code images} — готовые 1-битные картинки по ключу ({@code org.logo}).
     * Они уже чёрно-белые (дизеринг сделан на сервере), поэтому при масштабе 1:1
     * рисуются точка в точку, без сглаживания, а порог {@link #THRESHOLD} их не портит.
     */
    public static Bitmap draw(LabelLayout layout, Map<String, Bitmap> images) {
        Bitmap bitmap = Bitmap.createBitmap(layout.widthDots, layout.heightDots, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.WHITE);
        Paint fill = new Paint();
        fill.setStyle(Paint.Style.FILL);
        fill.setColor(Color.BLACK);
        Paint stroke = new Paint();
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeCap(Paint.Cap.BUTT);
        stroke.setColor(Color.BLACK);
        Paint regular = paint(false);
        Paint bold = paint(true);
        Paint smooth = new Paint(Paint.ANTI_ALIAS_FLAG);
        smooth.setColor(Color.BLACK);
        Paint crisp = new Paint();
        Paint scaled = new Paint(Paint.FILTER_BITMAP_FLAG);
        RectF box = new RectF();

        for (DrawOp op : layout.ops) {
            if (op instanceof DrawOp.Rect) {
                DrawOp.Rect r = (DrawOp.Rect) op;
                float radius = Math.min(r.radius, Math.min(r.right - r.left, r.bottom - r.top) / 2f);
                if (r.fill && radius > 0) {
                    box.set(r.left, r.top, r.right, r.bottom);
                    smooth.setStyle(Paint.Style.FILL);
                    canvas.drawRoundRect(box, radius, radius, smooth);
                } else if (r.fill) {
                    canvas.drawRect(r.left, r.top, r.right, r.bottom, fill);
                } else if (radius > 0) {
                    // Скруглённый контур тоже внутрь: линия идёт по середине толщины.
                    float half = r.thickness / 2f;
                    box.set(r.left + half, r.top + half, r.right - half, r.bottom - half);
                    smooth.setStyle(Paint.Style.STROKE);
                    smooth.setStrokeWidth(r.thickness);
                    float inner = Math.max(0f, radius - half);
                    canvas.drawRoundRect(box, inner, inner, smooth);
                } else {
                    // Контур внутрь: рамка не вылезает за край этикетки.
                    float t = r.thickness;
                    canvas.drawRect(r.left, r.top, r.right, r.top + t, fill);
                    canvas.drawRect(r.left, r.bottom - t, r.right, r.bottom, fill);
                    canvas.drawRect(r.left, r.top, r.left + t, r.bottom, fill);
                    canvas.drawRect(r.right - t, r.top, r.right, r.bottom, fill);
                }
            } else if (op instanceof DrawOp.Line) {
                DrawOp.Line l = (DrawOp.Line) op;
                stroke.setStrokeWidth(l.thickness);
                canvas.drawLine(l.x1, l.y1, l.x2, l.y2, stroke);
            } else if (op instanceof DrawOp.Image) {
                DrawOp.Image img = (DrawOp.Image) op;
                Bitmap source = images.get(img.src);
                if (source != null) {
                    int left = Math.round(img.left);
                    int top = Math.round(img.top);
                    int width = Math.max(1, Math.round(img.width));
                    int height = Math.max(1, Math.round(img.height));
                    box.set(left, top, left + width, top + height);
                    boolean natural = width == source.getWidth() && height == source.getHeight();
                    canvas.drawBitmap(source, null, box, natural ? crisp : scaled);
                }
            } else if (op instanceof DrawOp.Text) {
                DrawOp.Text t = (DrawOp.Text) op;
                Paint p = t.bold ? bold : regular;
                p.setTextSize(t.sizePx);
                p.setColor(t.white ? Color.WHITE : Color.BLACK);
                canvas.drawText(t.text, t.x, t.baseline, p);
            }
        }
        return bitmap;
    }

    public static MonoBitmap toMono(Bitmap bitmap) {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int[] pixels = new int[width * height];
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height);
        return MonoBitmap.fromArgb(pixels, width, height, THRESHOLD);
    }

    /** Предпросмотр: ровно те точки, что уйдут на принтер. */
    public static Bitmap preview(MonoBitmap image) {
        return Bitmap.createBitmap(image.toArgb(), image.width, image.height, Bitmap.Config.ARGB_8888);
    }

    private static Paint paint(boolean bold) {
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        paint.setTypeface(Typeface.create(Typeface.SANS_SERIF, bold ? Typeface.BOLD : Typeface.NORMAL));
        paint.setColor(Color.BLACK);
        return paint;
    }
}
