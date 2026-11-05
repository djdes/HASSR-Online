package ru.wesetup.helper.template;

/**
 * Элемент разметки шаблона. Координаты и размеры — в миллиметрах.
 *
 * <p>{@code TEXT}, {@code LINE}, {@code RECT} задаются в размерах шаблона и
 * масштабируются под этикетку. {@code FRAME} и {@code TICKS} — от краёв
 * самой этикетки и без масштаба: по ним на пробной этикетке видно, ровно ли
 * легла картинка и верен ли размер.
 */
public final class TemplateElement {

    public enum Type { TEXT, LINE, RECT, FRAME, TICKS, IMAGE }

    public enum Align { LEFT, CENTER, RIGHT }

    public enum VAlign { TOP, CENTER, BOTTOM }

    public final Type type;
    public float x;
    public float y;
    public float w;
    public float h;
    public float x2;
    public float y2;
    /** Толщина линии, мм. */
    public float thickness = 0.3f;
    /** Заливка прямоугольника. */
    public boolean fill;

    // Текст.
    public String text = "";
    /** Кегль — высота шрифта в мм. */
    public float size = 3f;
    public boolean bold;
    public Align align = Align.LEFT;
    public VAlign valign = VAlign.TOP;
    /** 0 — сколько поместится по высоте. */
    public int maxLines;
    /** Уменьшать шрифт, если текст не помещается. */
    public boolean fit = true;
    /** До какой доли кегля можно уменьшать. */
    public float minScale = 0.6f;
    /** Белый текст на чёрной плашке. */
    public boolean invert;

    /** Скругление углов RECT и FRAME, мм (у RECT масштабируется, у FRAME — нет). */
    public float radius;

    // Картинка: {@code src} — ключ картинки ({@code org.logo}), {@code fallbackText} — что печатать без неё.
    public String src = "";
    public String fallbackText = "";

    // Рамка и деления.
    public float inset = 0.75f;
    public float step = 5f;
    public float length = 1.5f;

    public TemplateElement(Type type) {
        this.type = type;
    }

    /** Независимая копия — для редактора макетов и истории «Отменить». */
    public TemplateElement copy() {
        TemplateElement c = new TemplateElement(type);
        c.x = x;
        c.y = y;
        c.w = w;
        c.h = h;
        c.x2 = x2;
        c.y2 = y2;
        c.thickness = thickness;
        c.fill = fill;
        c.text = text;
        c.size = size;
        c.bold = bold;
        c.align = align;
        c.valign = valign;
        c.maxLines = maxLines;
        c.fit = fit;
        c.minScale = minScale;
        c.invert = invert;
        c.radius = radius;
        c.src = src;
        c.fallbackText = fallbackText;
        c.inset = inset;
        c.step = step;
        c.length = length;
        return c;
    }
}
