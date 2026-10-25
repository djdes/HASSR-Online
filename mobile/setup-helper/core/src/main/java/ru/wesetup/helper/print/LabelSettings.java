package ru.wesetup.helper.print;

/**
 * Настройки этикетки для одного принтера.
 *
 * <p>Умолчания и пределы — из базы моделей драйвера AiYin (Seagull 12.3,
 * модель «AiYin IP-802BT»): 203 dpi, печатная ширина 72 мм, носитель от
 * 25,4 мм, этикетки с зазором, плотность 8, скорость 2–4 дюйма/с.
 */
public final class LabelSettings {

    /** 203 dpi = 8 точек на миллиметр. */
    public static final int DOTS_PER_MM = 8;
    public static final int MIN_WIDTH_MM = 25;
    /** Печатная ширина IP-802BT. Шире картинку принтер просто обрежет. */
    public static final int MAX_WIDTH_MM = 72;
    public static final int MIN_HEIGHT_MM = 10;
    public static final int MAX_HEIGHT_MM = 200;
    public static final float MAX_GAP_MM = 10f;
    public static final float MAX_SHIFT_MM = 5f;

    public int widthMm = 58;
    public int heightMm = 40;
    public float gapMm = 2f;
    public int density = 8;
    public int speed = 3;
    /** false — {@code DIRECTION 1}, true — {@code DIRECTION 0} (перевёрнуто на 180°). */
    public boolean rotate180 = false;
    public float shiftXmm = 0f;
    public float shiftYmm = 0f;

    public LabelSettings copy() {
        LabelSettings copy = new LabelSettings();
        copy.widthMm = widthMm;
        copy.heightMm = heightMm;
        copy.gapMm = gapMm;
        copy.density = density;
        copy.speed = speed;
        copy.rotate180 = rotate180;
        copy.shiftXmm = shiftXmm;
        copy.shiftYmm = shiftYmm;
        return copy;
    }

    /** Значения в допустимых пределах: настройки могли прийти из старой версии. */
    public LabelSettings normalized() {
        LabelSettings s = copy();
        s.widthMm = clamp(s.widthMm, MIN_WIDTH_MM, MAX_WIDTH_MM);
        s.heightMm = clamp(s.heightMm, MIN_HEIGHT_MM, MAX_HEIGHT_MM);
        s.gapMm = Math.round(clampF(s.gapMm, 0f, MAX_GAP_MM) * 2f) / 2f;
        s.density = clamp(s.density, 0, 15);
        s.speed = clamp(s.speed, 2, 4);
        s.shiftXmm = clampF(s.shiftXmm, -MAX_SHIFT_MM, MAX_SHIFT_MM);
        s.shiftYmm = clampF(s.shiftYmm, -MAX_SHIFT_MM, MAX_SHIFT_MM);
        return s;
    }

    public int widthDots() {
        return widthMm * DOTS_PER_MM;
    }

    public int heightDots() {
        return heightMm * DOTS_PER_MM;
    }

    /** «58×40» — так размер пишется на этикетке и в интерфейсе. */
    public String sizeLabel() {
        return widthMm + "×" + heightMm;
    }

    static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    static float clampF(float value, float min, float max) {
        if (Float.isNaN(value)) return min;
        return Math.max(min, Math.min(max, value));
    }
}
