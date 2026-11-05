package ru.wesetup.helper;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;

import androidx.core.content.ContextCompat;

import ru.wesetup.helper.template.LayoutEditing;
import ru.wesetup.helper.template.TemplateDraft;
import ru.wesetup.helper.template.TemplateElement;

/**
 * Холст редактора макета: этикетка (ровно те точки, что напечатает принтер),
 * поверх — пунктир вокруг элементов и синяя рамка выбранного с кружком
 * размера в правом нижнем углу (у линии — на её конце).
 *
 * <p>Нажатие выбирает элемент, перетаскивание двигает его, кружок меняет
 * размер. Все расчёты — в мм макета через {@link LayoutEditing}.
 */
public final class LayoutCanvasView extends View {

    interface Listener {
        void onSelected(int index);

        /** Первый сдвиг жеста — запомнить шаг для «Отменить». */
        void onEditStarted();

        /** Элемент сдвинут или изменён: перерисовать этикетку; {@code finished} — палец отпущен. */
        void onEdited(boolean finished);
    }

    private enum Mode { NONE, MOVE, RESIZE }

    private TemplateDraft draft;
    private Bitmap label;
    private int selected = -1;
    private Listener listener;

    private final Paint bitmapPaint = new Paint();
    private final Paint outline = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint selection = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint handleFill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint handleStroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint border = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF rect = new RectF();
    private final float density;

    private float scale = 1f;
    private float left;
    private float top;

    private Mode mode = Mode.NONE;
    private TemplateElement start;
    private float downX;
    private float downY;
    private boolean started;

    public LayoutCanvasView(Context context) {
        this(context, null);
    }

    public LayoutCanvasView(Context context, AttributeSet attrs) {
        super(context, attrs);
        density = getResources().getDisplayMetrics().density;
        int brand = ContextCompat.getColor(context, R.color.brand);
        // Без сглаживания: на экране видны точки принтера.
        bitmapPaint.setFilterBitmap(false);
        outline.setStyle(Paint.Style.STROKE);
        outline.setStrokeWidth(density);
        outline.setColor(0x665566F6);
        outline.setPathEffect(new DashPathEffect(new float[]{4 * density, 3 * density}, 0));
        selection.setStyle(Paint.Style.STROKE);
        selection.setStrokeWidth(2 * density);
        selection.setColor(brand);
        handleFill.setColor(brand);
        handleStroke.setStyle(Paint.Style.STROKE);
        handleStroke.setStrokeWidth(2 * density);
        handleStroke.setColor(0xFFFFFFFF);
        border.setStyle(Paint.Style.STROKE);
        border.setStrokeWidth(density);
        border.setColor(0xFFDCDFED);
        setContentDescription(context.getString(R.string.editor_canvas));
    }

    void setListener(Listener listener) {
        this.listener = listener;
    }

    void setDraft(TemplateDraft draft, Bitmap label) {
        boolean resized = this.draft == null || this.draft.widthMm != draft.widthMm
                || this.draft.heightMm != draft.heightMm;
        this.draft = draft;
        this.label = label;
        if (selected >= draft.elements.size()) selected = -1;
        if (resized) requestLayout();
        invalidate();
    }

    void setSelected(int index) {
        selected = index;
        invalidate();
    }

    int selected() {
        return selected;
    }

    /** Точка макета (мм) на экране — для проверок жестов. */
    float[] toScreen(float xMm, float yMm) {
        computeGeometry();
        return new float[]{left + xMm * scale, top + yMm * scale};
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int width = MeasureSpec.getSize(widthMeasureSpec);
        float ratio = draft == null ? 40f / 58f : draft.heightMm / draft.widthMm;
        // Высокую этикетку не растягиваем на весь экран: не выше 1,2 ширины.
        int height = Math.round(Math.min(width * ratio, width * 1.2f));
        setMeasuredDimension(width, height);
    }

    private void computeGeometry() {
        float pad = 14 * density;
        float availW = getWidth() - 2 * pad;
        float availH = getHeight() - 2 * pad;
        scale = Math.min(availW / draft.widthMm, availH / draft.heightMm);
        left = (getWidth() - draft.widthMm * scale) / 2f;
        top = (getHeight() - draft.heightMm * scale) / 2f;
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (draft == null) return;
        computeGeometry();
        rect.set(left, top, left + draft.widthMm * scale, top + draft.heightMm * scale);
        if (label != null) canvas.drawBitmap(label, null, rect, bitmapPaint);
        canvas.drawRect(rect, border);
        for (int i = 0; i < draft.elements.size(); i++) {
            TemplateElement e = draft.elements.get(i);
            if (i == selected || !LayoutEditing.movable(e)) continue;
            boxRect(e);
            canvas.drawRect(rect, outline);
        }
        if (selected >= 0 && selected < draft.elements.size()) {
            TemplateElement e = draft.elements.get(selected);
            boxRect(e);
            canvas.drawRect(rect, selection);
            if (LayoutEditing.movable(e)) {
                float hx = e.type == TemplateElement.Type.LINE ? e.x2 : e.x + e.w;
                float hy = e.type == TemplateElement.Type.LINE ? e.y2 : e.y + e.h;
                float cx = left + hx * scale;
                float cy = top + hy * scale;
                canvas.drawCircle(cx, cy, 9 * density, handleFill);
                canvas.drawCircle(cx, cy, 9 * density, handleStroke);
            }
        }
    }

    /** Коробка элемента на экране; тонкую линию расширяем, чтобы рамку было видно. */
    private void boxRect(TemplateElement e) {
        float[] b = LayoutEditing.box(e, draft.widthMm, draft.heightMm);
        float grow = e.type == TemplateElement.Type.LINE ? 3 * density : 0;
        rect.set(left + b[0] * scale - grow, top + b[1] * scale - grow,
                left + b[2] * scale + grow, top + b[3] * scale + grow);
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (draft == null) return false;
        computeGeometry();
        float x = (event.getX() - left) / scale;
        float y = (event.getY() - top) / scale;
        // Запас под палец ~ 12 dp, в мм макета.
        float slop = 12 * density / scale;
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN: {
                downX = x;
                downY = y;
                started = false;
                mode = Mode.NONE;
                if (selected >= 0 && selected < draft.elements.size()
                        && LayoutEditing.hitHandle(draft.elements.get(selected), x, y, slop * 1.5f)) {
                    mode = Mode.RESIZE;
                } else {
                    int index = LayoutEditing.hit(draft.elements, x, y, slop, draft.widthMm, draft.heightMm);
                    if (index != selected) {
                        selected = index;
                        if (listener != null) listener.onSelected(index);
                    }
                    if (index >= 0 && LayoutEditing.movable(draft.elements.get(index))) mode = Mode.MOVE;
                }
                if (mode != Mode.NONE) {
                    start = draft.elements.get(selected).copy();
                    getParent().requestDisallowInterceptTouchEvent(true);
                }
                invalidate();
                return true;
            }
            case MotionEvent.ACTION_MOVE: {
                if (mode == Mode.NONE) return true;
                float dx = x - downX;
                float dy = y - downY;
                if (!started) {
                    if (Math.abs(dx) < LayoutEditing.STEP_MM / 2 && Math.abs(dy) < LayoutEditing.STEP_MM / 2) return true;
                    started = true;
                    if (listener != null) listener.onEditStarted();
                }
                TemplateElement e = draft.elements.get(selected);
                if (mode == Mode.MOVE) {
                    LayoutEditing.moveFrom(e, start, dx, dy, draft.widthMm, draft.heightMm);
                } else {
                    LayoutEditing.resizeFrom(e, start, dx, dy, draft.widthMm, draft.heightMm);
                }
                if (listener != null) listener.onEdited(false);
                return true;
            }
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                if (started && listener != null) listener.onEdited(true);
                if (event.getActionMasked() == MotionEvent.ACTION_UP && !started) performClick();
                mode = Mode.NONE;
                started = false;
                getParent().requestDisallowInterceptTouchEvent(false);
                return true;
            default:
                return true;
        }
    }

    @Override
    public boolean performClick() {
        return super.performClick();
    }
}
