package ru.wesetup.helper;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.app.Activity;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.os.Looper;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.button.MaterialButtonToggleGroup;
import com.google.android.material.chip.ChipGroup;
import com.google.android.material.textfield.TextInputLayout;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.shadows.ShadowDialog;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

import ru.wesetup.helper.template.LabelTemplate;
import ru.wesetup.helper.template.TemplateDraft;
import ru.wesetup.helper.template.TemplateElement;
import ru.wesetup.helper.template.TemplateField;
import ru.wesetup.helper.template.TemplateRepository;

/**
 * Макеты на телефоне: хранение, редактор и печать по изменённому макету —
 * без входа и сети.
 */
@RunWith(RobolectricTestRunner.class)
@Config(application = TestHelperApp.class, sdk = 36, qualifiers = "w411dp-h891dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class LayoutsTest {

    private static final File SCREENS = new File("build/layout-screens");

    private HelperApp app;
    private TemplateRepository repo;

    @Before
    public void setUp() {
        app = (HelperApp) RuntimeEnvironment.getApplication();
        repo = app.templates();
        //noinspection ResultOfMethodCallIgnored
        SCREENS.mkdirs();
    }

    // ------------------------------------------------------------- хранение

    @Test
    public void testModifiedBuiltInReplacesItAndResetRestores() throws Exception {
        int count = repo.all().size();
        TemplateDraft draft = TemplateDraft.of(repo.byId("product"));
        draft.title = "Маркировка — холодный цех";
        repo.save(draft.build());

        assertEquals("не добавился, а подменил", count, repo.all().size());
        assertEquals("Маркировка — холодный цех", repo.byId("product").title);
        assertTrue(repo.isModified("product"));
        assertEquals("Маркировка продукта", repo.original("product").title);
        assertTrue(new File(app.getFilesDir(), "layouts/product.json").exists());

        repo.reset("product");
        assertEquals("Маркировка продукта", repo.byId("product").title);
        assertFalse(repo.isModified("product"));
    }

    @Test
    public void testOwnLayoutIsAddedAfterBuiltInsAndDeleted() throws Exception {
        int count = repo.all().size();
        TemplateDraft draft = TemplateDraft.of(repo.byId("free-text"));
        draft.id = repo.newId();
        draft.title = "Мой макет";
        repo.save(draft.build());

        assertEquals(count + 1, repo.all().size());
        assertEquals(draft.id, repo.all().get(count).id);
        assertTrue(draft.id.startsWith(TemplateRepository.CUSTOM_PREFIX));
        assertFalse(repo.isBuiltIn(draft.id));

        repo.reset(draft.id);
        assertEquals(count, repo.all().size());
        assertNull(repo.byId(draft.id));
    }

    @Test
    public void testBrokenFileIsSkippedWithoutCrash() throws Exception {
        File dir = new File(app.getFilesDir(), "layouts");
        assertTrue(dir.isDirectory() || dir.mkdirs());
        try (FileOutputStream out = new FileOutputStream(new File(dir, "product.json"))) {
            out.write("{ не json".getBytes(StandardCharsets.UTF_8));
        }
        try (FileOutputStream out = new FileOutputStream(new File(dir, "my-x.json"))) {
            out.write("{\"id\":\"другой\"}".getBytes(StandardCharsets.UTF_8));
        }
        TemplateRepository fresh = new TemplateRepository(app);
        assertEquals("Маркировка продукта", fresh.byId("product").title);
        assertEquals(repo.all().size(), fresh.all().size());
        assertFalse(fresh.isModified("product"));
    }

    // ------------------------------------------------------------- экраны

    @Test
    public void testLayoutsScreenListsEveryLayoutWithBadges() throws Exception {
        TemplateDraft draft = TemplateDraft.of(repo.byId("dish"));
        draft.title = "Блюдо — раздача";
        repo.save(draft.build());

        LayoutsActivity activity = Robolectric.buildActivity(LayoutsActivity.class).setup().get();
        LinearLayout list = activity.findViewById(R.id.layouts_list);
        assertEquals(repo.all().size(), list.getChildCount());
        View dish = list.findViewWithTag("dish");
        assertEquals("Блюдо — раздача", ((TextView) dish.findViewById(R.id.layout_title)).getText().toString());
        assertEquals("Изменён на телефоне", ((TextView) dish.findViewById(R.id.layout_badge)).getText().toString());
        View product = list.findViewWithTag("product");
        assertEquals("Встроенный", ((TextView) product.findViewById(R.id.layout_badge)).getText().toString());
        save(screen(activity), "1-layouts.png");

        product.performClick();
        Intent next = shadowOf(activity).getNextStartedActivity();
        assertEquals(LayoutEditorActivity.class.getName(), next.getComponent().getClassName());
        assertEquals("product", next.getStringExtra(LayoutEditorActivity.EXTRA_ID));
    }

    @Test
    public void testEditorEditsSavesAndPrintUsesTheNewLayout() throws Exception {
        Intent intent = new Intent(app, LayoutEditorActivity.class).putExtra(LayoutEditorActivity.EXTRA_ID, "product");
        ActivityController<LayoutEditorActivity> controller = Robolectric.buildActivity(LayoutEditorActivity.class, intent);
        LayoutEditorActivity editor = controller.setup().visible().get();
        idle();
        LayoutCanvasView canvas = editor.findViewById(R.id.editor_canvas);
        assertTrue("холст разложен", canvas.getWidth() > 0 && canvas.getHeight() > 0);

        // Нажатие на название продукта выбирает его.
        TemplateElement productText = repo.byId("product").elements.get(4);
        float cx = productText.x + productText.w / 2f;
        float cy = productText.y + productText.h / 2f;
        tap(canvas, cx, cy);
        assertEquals(4, canvas.selected());
        LinearLayout panel = editor.findViewById(R.id.editor_panel);
        EditText text = firstInput(panel);
        assertEquals("{{product}}", text.getText().toString());
        save(screen(editor), "2-editor-selected.png");

        // Перетаскивание на 2 мм вниз.
        drag(canvas, cx, cy, cx, cy + 2f);
        // Текст: крупными буквами.
        text = firstInput(panel);
        text.setText("{{product|upper}}");
        idle();

        // Новое поле «Партия» — сразу на этикетке.
        ((MaterialButtonToggleGroup) editor.findViewById(R.id.editor_tabs)).check(R.id.editor_tab_fields);
        idle();
        button(panel, "Текстовое поле").performClick();
        AlertDialog dialog = (AlertDialog) ShadowDialog.getLatestDialog();
        firstInput((ViewGroup) dialog.getWindow().getDecorView()).setText("Партия");
        dialog.getButton(DialogInterface.BUTTON_POSITIVE).performClick();
        idle();
        assertEquals(5, draftOf(editor).fields.size());
        assertEquals("после добавления поля — вкладка элемента", R.id.editor_tab_element,
                ((MaterialButtonToggleGroup) editor.findViewById(R.id.editor_tabs)).getCheckedButtonId());
        assertEquals("новая строка выбрана", draftOf(editor).elements.size() - 1, canvas.selected());

        // Удалить и вернуть «Отменить».
        int before = countElements(editor);
        button(panel, "Удалить").performClick();
        idle();
        assertEquals(before - 1, countElements(editor));
        editor.findViewById(R.id.editor_undo).performClick();
        idle();
        assertEquals(before, countElements(editor));
        save(screen(editor), "3-editor-field-added.png");

        editor.findViewById(R.id.editor_save).performClick();
        idle();
        assertTrue("после сохранения экран закрыт", editor.isFinishing());

        LabelTemplate saved = repo.byId("product");
        assertTrue(repo.isModified("product"));
        assertEquals("{{product|upper}}", saved.elements.get(4).text);
        assertEquals(productText.y + 2f, saved.elements.get(4).y, 0.001f);
        assertNotNull(saved.field("field1"));
        assertEquals("Партия", saved.field("field1").label);
        assertEquals(TemplateField.Type.TEXT, saved.field("field1").type);
        assertEquals("Партия: {{field1}}", saved.elements.get(saved.elements.size() - 1).text);

        // Печать: тот же макет с новым полем.
        Intent print = new Intent(app, PrintActivity.class).putExtra(PrintActivity.EXTRA_TEMPLATE, "product");
        PrintActivity activity = Robolectric.buildActivity(PrintActivity.class, print).setup().get();
        assertEquals(repo.all().size(), ((ChipGroup) activity.findViewById(R.id.print_templates)).getChildCount());
        LinearLayout fields = activity.findViewById(R.id.print_fields);
        assertEquals(saved.fields.size(), fields.getChildCount());
        assertEquals("Партия", ((TextInputLayout) fields.getChildAt(fields.getChildCount() - 1)).getHint().toString());
    }

    @Test
    public void testLeavingWithChangesAsksToSave() {
        Intent intent = new Intent(app, LayoutEditorActivity.class).putExtra(LayoutEditorActivity.EXTRA_ID, "reject");
        LayoutEditorActivity editor = Robolectric.buildActivity(LayoutEditorActivity.class, intent).setup().visible().get();
        idle();
        button(editor.findViewById(R.id.editor_panel), "Линия").performClick();
        idle();
        editor.findViewById(R.id.editor_back).performClick();
        AlertDialog dialog = (AlertDialog) ShadowDialog.getLatestDialog();
        assertNotNull(dialog);
        assertTrue(dialog.isShowing());
        dialog.getButton(DialogInterface.BUTTON_NEGATIVE).performClick();
        idle();
        assertTrue(editor.isFinishing());
        assertFalse("«Не сохранять» — макет прежний", repo.isModified("reject"));
    }

    @Test
    public void testNewBlankLayoutAppearsInPrint() throws Exception {
        Intent intent = new Intent(app, LayoutEditorActivity.class).putExtra(LayoutEditorActivity.EXTRA_BLANK, true);
        LayoutEditorActivity editor = Robolectric.buildActivity(LayoutEditorActivity.class, intent).setup().visible().get();
        idle();
        ((MaterialButtonToggleGroup) editor.findViewById(R.id.editor_tabs)).check(R.id.editor_tab_layout);
        idle();
        LinearLayout panel = editor.findViewById(R.id.editor_panel);
        firstInput(panel).setText("Ценник витрины");
        button(panel, "40×30").performClick();
        idle();
        save(screen(editor), "4-editor-layout-tab.png");
        editor.findViewById(R.id.editor_save).performClick();
        idle();
        assertTrue(editor.isFinishing());

        LabelTemplate own = repo.all().get(repo.all().size() - 1);
        assertEquals("Ценник витрины", own.title);
        assertEquals(40f, own.widthMm, 0.001f);
        assertEquals(30f, own.heightMm, 0.001f);
        assertFalse(repo.isBuiltIn(own.id));
    }

    // ------------------------------------------------------------- помощники

    private static void idle() {
        shadowOf(Looper.getMainLooper()).idle();
    }

    private int countElements(LayoutEditorActivity editor) {
        return draftOf(editor).elements.size();
    }

    private static TemplateDraft draftOf(LayoutEditorActivity editor) {
        try {
            java.lang.reflect.Field f = LayoutEditorActivity.class.getDeclaredField("draft");
            f.setAccessible(true);
            return (TemplateDraft) f.get(editor);
        } catch (ReflectiveOperationException e) {
            throw new AssertionError(e);
        }
    }

    private static void tap(LayoutCanvasView canvas, float xMm, float yMm) {
        float[] p = canvas.toScreen(xMm, yMm);
        long t = SystemClock.uptimeMillis();
        canvas.dispatchTouchEvent(MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, p[0], p[1], 0));
        canvas.dispatchTouchEvent(MotionEvent.obtain(t, t + 50, MotionEvent.ACTION_UP, p[0], p[1], 0));
        idle();
    }

    private static void drag(LayoutCanvasView canvas, float x1, float y1, float x2, float y2) {
        float[] a = canvas.toScreen(x1, y1);
        float[] b = canvas.toScreen(x2, y2);
        long t = SystemClock.uptimeMillis();
        canvas.dispatchTouchEvent(MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, a[0], a[1], 0));
        for (int i = 1; i <= 5; i++) {
            float k = i / 5f;
            canvas.dispatchTouchEvent(MotionEvent.obtain(t, t + i * 16, MotionEvent.ACTION_MOVE,
                    a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, 0));
        }
        canvas.dispatchTouchEvent(MotionEvent.obtain(t, t + 120, MotionEvent.ACTION_UP, b[0], b[1], 0));
        idle();
    }

    private static EditText firstInput(ViewGroup root) {
        for (int i = 0; i < root.getChildCount(); i++) {
            View child = root.getChildAt(i);
            if (child instanceof EditText) return (EditText) child;
            if (child instanceof ViewGroup) {
                EditText found = firstInput((ViewGroup) child);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static View button(ViewGroup root, String text) {
        View found = findText(root, text);
        assertNotNull("нет кнопки «" + text + "»", found);
        return found;
    }

    private static View findText(ViewGroup root, String text) {
        for (int i = 0; i < root.getChildCount(); i++) {
            View child = root.getChildAt(i);
            if (child instanceof TextView && !(child instanceof EditText)
                    && text.contentEquals(((TextView) child).getText())) {
                return child;
            }
            if (child instanceof ViewGroup) {
                View found = findText((ViewGroup) child, text);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static Bitmap screen(Activity activity) {
        idle();
        View root = activity.getWindow().getDecorView();
        int width = 1080;
        int height = 2340;
        root.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
        root.layout(0, 0, width, height);
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.WHITE);
        root.draw(canvas);
        return bitmap;
    }

    private static void save(Bitmap bitmap, String name) throws Exception {
        try (FileOutputStream out = new FileOutputStream(new File(SCREENS, name))) {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
        }
    }
}
