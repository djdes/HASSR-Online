package ru.wesetup.helper.template;

/** Команда рисования в точках принтера (8 точек = 1 мм). */
public abstract class DrawOp {

    private DrawOp() {
    }

    public static final class Text extends DrawOp {
        public final String text;
        /** Левый край строки. */
        public final float x;
        public final float baseline;
        public final float sizePx;
        public final boolean bold;
        public final boolean white;

        Text(String text, float x, float baseline, float sizePx, boolean bold, boolean white) {
            this.text = text;
            this.x = x;
            this.baseline = baseline;
            this.sizePx = sizePx;
            this.bold = bold;
            this.white = white;
        }
    }

    public static final class Line extends DrawOp {
        public final float x1;
        public final float y1;
        public final float x2;
        public final float y2;
        public final float thickness;

        Line(float x1, float y1, float x2, float y2, float thickness) {
            this.x1 = x1;
            this.y1 = y1;
            this.x2 = x2;
            this.y2 = y2;
            this.thickness = thickness;
        }
    }

    /** Прямоугольник; {@code fill} — залитый, иначе контур толщиной {@code thickness} внутрь. */
    public static final class Rect extends DrawOp {
        public final float left;
        public final float top;
        public final float right;
        public final float bottom;
        public final float thickness;
        public final boolean fill;

        Rect(float left, float top, float right, float bottom, float thickness, boolean fill) {
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
            this.thickness = thickness;
            this.fill = fill;
        }
    }
}
