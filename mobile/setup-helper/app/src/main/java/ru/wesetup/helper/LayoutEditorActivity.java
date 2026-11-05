package ru.wesetup.helper;

import android.content.Intent;
import android.content.res.ColorStateList;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.core.content.ContextCompat;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.button.MaterialButtonToggleGroup;
import com.google.android.material.card.MaterialCardView;
import com.google.android.material.chip.Chip;
import com.google.android.material.chip.ChipGroup;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.materialswitch.MaterialSwitch;
import com.google.android.material.textfield.TextInputLayout;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;

import ru.wesetup.helper.print.LabelSettings;
import ru.wesetup.helper.template.Durations;
import ru.wesetup.helper.template.LabelTemplate;
import ru.wesetup.helper.template.LayoutEditing;
import ru.wesetup.helper.template.TemplateDraft;
import ru.wesetup.helper.template.TemplateElement;
import ru.wesetup.helper.template.TemplateField;
import ru.wesetup.helper.template.TemplateRepository;
import ru.wesetup.helper.template.TemplateWriter;

/**
 * Редактор макета этикетки на телефоне — без входа и интернета.
 *
 * <p>Сверху — этикетка: нажать на элемент — выбрать, тянуть — двигать, синий
 * кружок — размер. Ниже три вкладки: «Элемент» (текст, кегль, выравнивание,
 * толщина, сдвиг стрелками, копия, удаление и новые элементы), «Поля» (что
 * спрашивается перед печатью) и «Макет» (название, размер, вернуть как было).
 * «Отменить» — шаг назад, «Сохранить» — макет сразу в печати.
 */
public final class LayoutEditorActivity extends BaseActivity implements LayoutCanvasView.Listener {

    /** Изменить макет с этим кодом. */
    static final String EXTRA_ID = "id";
    /** Новый макет — копия макета с этим кодом. */
    static final String EXTRA_COPY_OF = "copyOf";
    /** Новый макет с нуля. */
    static final String EXTRA_BLANK = "blank";
    /** В ответе: код сохранённого макета. */
    static final String RESULT_ID = "savedId";

    private static final int TAB_ELEMENT = 0;
    private static final int TAB_FIELDS = 1;
    private static final int TAB_LAYOUT = 2;
    private static final int MAX_UNDO = 60;
    private static final int[][] SIZE_PRESETS = {{58, 40}, {58, 30}, {58, 60}, {40, 30}, {30, 20}};

    private HelperApp app;
    private TemplateRepository repo;
    private TemplateDraft draft;
    /** JSON последнего сохранения: с ним сравниваем, есть ли несохранённое. */
    private String savedJson;
    private boolean isNew;
    private final Deque<TemplateDraft> undo = new ArrayDeque<>();
    private int tab = TAB_ELEMENT;
    /** Набор текста — один шаг «Отменить», пока не выбран другой элемент или поле. */
    private Object typingTarget;

    private LayoutCanvasView canvas;
    private LinearLayout panel;
    private MaterialButton undoButton;
    private TextView subtitle;
    private MaterialButtonToggleGroup tabs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable refresh = this::refreshCanvas;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        app = HelperApp.get(this);
        repo = app.templates();
        if (!openDraft()) {
            finish();
            return;
        }
        setContentView(R.layout.activity_layout_editor);
        Ui.applySystemBarInsets(this, findViewById(R.id.editor_root));
        canvas = findViewById(R.id.editor_canvas);
        panel = findViewById(R.id.editor_panel);
        undoButton = findViewById(R.id.editor_undo);
        subtitle = findViewById(R.id.editor_subtitle);
        tabs = findViewById(R.id.editor_tabs);
        canvas.setListener(this);

        findViewById(R.id.editor_back).setOnClickListener(v -> leave());
        undoButton.setOnClickListener(v -> undo());
        findViewById(R.id.editor_save).setOnClickListener(v -> save());
        tabs.addOnButtonCheckedListener((group, id, checked) -> {
            if (!checked) return;
            int next = id == R.id.editor_tab_fields ? TAB_FIELDS : id == R.id.editor_tab_layout ? TAB_LAYOUT : TAB_ELEMENT;
            if (next != tab) {
                tab = next;
                typingTarget = null;
                showPanel();
            }
        });
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                leave();
            }
        });
        refreshCanvas();
        showPanel();
    }

    /** Черновик из extras: правка, копия или новый. */
    private boolean openDraft() {
        Intent intent = getIntent();
        String id = intent.getStringExtra(EXTRA_ID);
        String copyOf = intent.getStringExtra(EXTRA_COPY_OF);
        if (id != null) {
            LabelTemplate template = repo.byId(id);
            if (template == null) return false;
            draft = TemplateDraft.of(template);
            savedJson = TemplateWriter.write(draft);
            return true;
        }
        LabelTemplate source = copyOf != null ? repo.byId(copyOf) : repo.original("free-text");
        if (source == null && !repo.all().isEmpty()) source = repo.all().get(0);
        if (source == null) return false;
        draft = TemplateDraft.of(source);
        draft.id = repo.newId();
        draft.title = copyOf != null ? getString(R.string.layouts_copy_title, source.title)
                : getString(R.string.layouts_new_title);
        if (copyOf == null) draft.description = "";
        isNew = true;
        savedJson = "";
        return true;
    }

    // ---------------------------------------------------------------- холст

    private void refreshCanvas() {
        main.removeCallbacks(refresh);
        canvas.setDraft(draft, LayoutPreview.render(app, draft));
        subtitle.setText(getString(R.string.editor_subtitle, draft.title.trim().isEmpty() ? "—" : draft.title.trim(),
                MainActivity.formatMm(draft.widthMm), MainActivity.formatMm(draft.heightMm)));
        undoButton.setEnabled(!undo.isEmpty());
        undoButton.setAlpha(undo.isEmpty() ? 0.4f : 1f);
    }

    private void scheduleRefresh() {
        main.removeCallbacks(refresh);
        main.postDelayed(refresh, 150);
    }

    private void checkpoint() {
        undo.push(draft.copy());
        while (undo.size() > MAX_UNDO) undo.removeLast();
        undoButton.setEnabled(true);
        undoButton.setAlpha(1f);
    }

    /** Шаг для «Отменить» перед первым изменением набираемого текста. */
    private void checkpointTyping(Object target) {
        if (typingTarget == target) return;
        typingTarget = target;
        checkpoint();
    }

    private void undo() {
        if (undo.isEmpty()) return;
        int selected = canvas.selected();
        draft = undo.pop();
        typingTarget = null;
        canvas.setSelected(selected < draft.elements.size() ? selected : -1);
        refreshCanvas();
        showPanel();
    }

    @Override
    public void onSelected(int index) {
        typingTarget = null;
        if (tab != TAB_ELEMENT) {
            tabs.check(R.id.editor_tab_element);
        } else {
            showPanel();
        }
    }

    @Override
    public void onEditStarted() {
        typingTarget = null;
        checkpoint();
    }

    @Override
    public void onEdited(boolean finished) {
        refreshCanvas();
        if (finished && tab == TAB_ELEMENT) showPanel();
    }

    private TemplateElement selected() {
        int i = canvas.selected();
        return i >= 0 && i < draft.elements.size() ? draft.elements.get(i) : null;
    }

    // ---------------------------------------------------------------- панели

    private void showPanel() {
        panel.removeAllViews();
        switch (tab) {
            case TAB_FIELDS:
                showFields();
                break;
            case TAB_LAYOUT:
                showLayout();
                break;
            default:
                showElement();
        }
    }

    private void showElement() {
        TemplateElement e = selected();
        if (e == null) {
            panel.addView(muted(getString(R.string.editor_pick_hint)));
        } else {
            showElementProps(e);
        }
        panel.addView(section(getString(R.string.editor_add_title), 20));
        LinearLayout row1 = row();
        row1.addView(weighted(outlined(getString(R.string.editor_add_text), R.drawable.ic_add,
                v -> addElement(LayoutEditing.newText(getString(R.string.editor_new_text), draft.widthMm, draft.heightMm)))));
        row1.addView(weighted(outlined(getString(R.string.editor_add_plate), R.drawable.ic_add,
                v -> addElement(LayoutEditing.newPlate(getString(R.string.editor_new_plate), draft.widthMm, draft.heightMm)))));
        panel.addView(row1);
        LinearLayout row2 = row();
        row2.addView(weighted(outlined(getString(R.string.editor_add_line), R.drawable.ic_add,
                v -> addElement(LayoutEditing.newLine(draft.widthMm, draft.heightMm)))));
        row2.addView(weighted(outlined(getString(R.string.editor_add_rect), R.drawable.ic_add,
                v -> addElement(LayoutEditing.newRect(draft.widthMm, draft.heightMm)))));
        panel.addView(row2);
    }

    private void showElementProps(TemplateElement e) {
        panel.addView(section(typeName(e), 0));
        boolean textual = e.type == TemplateElement.Type.TEXT || e.type == TemplateElement.Type.IMAGE;
        if (textual) {
            boolean image = e.type == TemplateElement.Type.IMAGE;
            TextInputLayout layout = input(getString(image ? R.string.editor_logo_text : R.string.editor_text),
                    image ? e.fallbackText : e.text, true);
            EditText text = layout.getEditText();
            text.addTextChangedListener(watcher(() -> {
                checkpointTyping(e);
                String value = text.getText() == null ? "" : text.getText().toString();
                if (image) e.fallbackText = value;
                else e.text = value;
                scheduleRefresh();
            }));
            panel.addView(layout);
            if (image) panel.addView(muted(getString(R.string.editor_logo_note)));
            MaterialButton insert = outlined(getString(R.string.editor_insert), R.drawable.ic_add,
                    v -> chooseInsert(text));
            panel.addView(insert);
            panel.addView(muted(getString(R.string.editor_insert_note)));

            panel.addView(stepper(getString(R.string.editor_size), mm(e.size), steps -> {
                checkpoint();
                e.size = LayoutEditing.textSize(e.size, steps);
                refreshCanvas();
                return mm(e.size);
            }));
            panel.addView(toggle(getString(R.string.editor_bold), e.bold, on -> e.bold = on));
            if (!image) {
                panel.addView(toggle(getString(R.string.editor_invert), e.invert, on -> e.invert = on));
            }
            panel.addView(alignGroup(e));
        } else {
            panel.addView(stepper(getString(R.string.editor_thickness), mm(e.thickness), steps -> {
                checkpoint();
                e.thickness = LayoutEditing.thickness(e.thickness, steps);
                refreshCanvas();
                return mm(e.thickness);
            }));
            if (e.type == TemplateElement.Type.RECT) {
                panel.addView(toggle(getString(R.string.editor_fill), e.fill, on -> e.fill = on));
            }
            if (!LayoutEditing.movable(e)) panel.addView(muted(getString(R.string.editor_frame_note)));
        }

        if (LayoutEditing.movable(e)) {
            panel.addView(section(getString(R.string.editor_position, mm(e.x), mm(e.y)), 16));
            LinearLayout arrows = row();
            arrows.addView(weighted(iconButton(R.drawable.ic_chevron_left, R.string.editor_left, v -> nudge(-1, 0))));
            arrows.addView(weighted(iconButton(R.drawable.ic_chevron_up, R.string.editor_up, v -> nudge(0, -1))));
            arrows.addView(weighted(iconButton(R.drawable.ic_chevron_down, R.string.editor_down, v -> nudge(0, 1))));
            arrows.addView(weighted(iconButton(R.drawable.ic_chevron_right, R.string.editor_right, v -> nudge(1, 0))));
            panel.addView(arrows);
        }

        LinearLayout actions = row();
        if (LayoutEditing.movable(e)) {
            actions.addView(weighted(outlined(getString(R.string.editor_duplicate), R.drawable.ic_copy, v -> duplicate())));
        }
        MaterialButton delete = outlined(getString(R.string.editor_delete), R.drawable.ic_delete, v -> deleteSelected());
        int danger = ContextCompat.getColor(this, R.color.danger);
        delete.setTextColor(danger);
        delete.setIconTint(ColorStateList.valueOf(danger));
        delete.setStrokeColor(ColorStateList.valueOf(ContextCompat.getColor(this, R.color.danger_soft)));
        actions.addView(weighted(delete));
        panel.addView(actions);
    }

    private String typeName(TemplateElement e) {
        switch (e.type) {
            case TEXT:
                return getString(e.invert ? R.string.editor_type_plate : R.string.editor_type_text);
            case LINE:
                return getString(R.string.editor_type_line);
            case RECT:
                return getString(R.string.editor_type_rect);
            case FRAME:
                return getString(R.string.editor_type_frame);
            case TICKS:
                return getString(R.string.editor_type_ticks);
            case IMAGE:
                return getString(R.string.editor_type_logo);
            default:
                return "";
        }
    }

    private View alignGroup(TemplateElement e) {
        MaterialButtonToggleGroup group = new MaterialButtonToggleGroup(this);
        group.setSingleSelection(true);
        group.setSelectionRequired(true);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(8);
        group.setLayoutParams(lp);
        TemplateElement.Align[] aligns = TemplateElement.Align.values();
        int[] labels = {R.string.editor_align_left, R.string.editor_align_center, R.string.editor_align_right};
        for (int i = 0; i < aligns.length; i++) {
            MaterialButton b = new MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle);
            b.setId(View.generateViewId());
            b.setText(labels[i]);
            b.setMinHeight(dp(48));
            b.setLayoutParams(new LinearLayout.LayoutParams(0, dp(48), 1f));
            b.setTag(aligns[i]);
            group.addView(b);
            if (aligns[i] == e.align) group.check(b.getId());
        }
        group.addOnButtonCheckedListener((g, id, checked) -> {
            if (!checked) return;
            TemplateElement.Align next = (TemplateElement.Align) g.findViewById(id).getTag();
            if (next == e.align) return;
            checkpoint();
            e.align = next;
            refreshCanvas();
        });
        return group;
    }

    private void chooseInsert(EditText target) {
        List<LayoutEditing.Insert> inserts = LayoutEditing.inserts(draft);
        String[] titles = new String[inserts.size()];
        for (int i = 0; i < inserts.size(); i++) titles[i] = inserts.get(i).title;
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.editor_insert_title)
                .setItems(titles, (d, which) -> {
                    String code = inserts.get(which).code;
                    Editable text = target.getText();
                    if (text == null) return;
                    int start = Math.max(0, target.getSelectionStart());
                    int end = Math.max(start, target.getSelectionEnd());
                    text.replace(start, end, code);
                    target.requestFocus();
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    /** Новый элемент — на свободное место этикетки, выбран. */
    private void addElement(TemplateElement e) {
        LayoutEditing.placeFree(draft.elements, e, draft.widthMm, draft.heightMm);
        addElementAsIs(e);
    }

    private void addElementAsIs(TemplateElement e) {
        checkpoint();
        draft.elements.add(e);
        canvas.setSelected(draft.elements.size() - 1);
        typingTarget = null;
        refreshCanvas();
        showPanel();
        // Новый элемент выбран на этикетке — показываем её, а не низ панели.
        android.widget.ScrollView scroll = findViewById(R.id.editor_scroll);
        scroll.post(() -> scroll.smoothScrollTo(0, 0));
    }

    private void nudge(int dx, int dy) {
        TemplateElement e = selected();
        if (e == null) return;
        checkpoint();
        typingTarget = null;
        LayoutEditing.nudge(e, dx, dy, draft.widthMm, draft.heightMm);
        refreshCanvas();
        showPanel();
    }

    private void duplicate() {
        TemplateElement e = selected();
        if (e == null) return;
        TemplateElement copy = e.copy();
        LayoutEditing.nudge(copy, 2, 2, draft.widthMm, draft.heightMm);
        addElementAsIs(copy);
    }

    private void deleteSelected() {
        int index = canvas.selected();
        if (index < 0 || index >= draft.elements.size()) return;
        checkpoint();
        draft.elements.remove(index);
        canvas.setSelected(-1);
        typingTarget = null;
        refreshCanvas();
        showPanel();
        Toast.makeText(this, R.string.editor_deleted, Toast.LENGTH_SHORT).show();
    }

    // ---------------------------------------------------------------- поля

    private void showFields() {
        panel.addView(muted(getString(R.string.editor_fields_note)));
        for (TemplateDraft.Field f : draft.fields) panel.addView(fieldCard(f));
        if (draft.fields.isEmpty()) panel.addView(muted(getString(R.string.editor_fields_empty)));
        LinearLayout add = row();
        add.addView(weighted(outlined(getString(R.string.editor_add_text_field), R.drawable.ic_add,
                v -> askNewField(TemplateField.Type.TEXT))));
        add.addView(weighted(outlined(getString(R.string.editor_add_date_field), R.drawable.ic_add,
                v -> askNewField(TemplateField.Type.DATETIME))));
        panel.addView(add);
    }

    private View fieldCard(TemplateDraft.Field f) {
        MaterialCardView card = new MaterialCardView(this, null, com.google.android.material.R.attr.materialCardViewOutlinedStyle);
        card.setRadius(dp(16));
        card.setStrokeColor(ContextCompat.getColor(this, R.color.border));
        card.setCardElevation(0);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(10);
        card.setLayoutParams(lp);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(14), dp(4), dp(14), dp(12));
        card.addView(box);

        LinearLayout head = row();
        head.setGravity(Gravity.CENTER_VERTICAL);
        TextInputLayout name = input(getString(R.string.editor_field_label), f.label, false);
        EditText nameInput = name.getEditText();
        nameInput.addTextChangedListener(watcher(() -> {
            checkpointTyping(f);
            f.label = nameInput.getText() == null ? "" : nameInput.getText().toString();
            scheduleRefresh();
        }));
        head.addView(weighted(name));
        MaterialButton remove = iconButton(R.drawable.ic_delete, R.string.editor_field_delete, v -> deleteField(f));
        remove.setIconTint(ColorStateList.valueOf(ContextCompat.getColor(this, R.color.danger)));
        head.addView(remove);
        box.addView(head);

        boolean used = usedOnLabel(f);
        String kind = getString(fieldKind(f));
        box.addView(muted(used ? getString(R.string.editor_field_used, kind)
                : getString(R.string.editor_field_unused, kind)));
        if (!used) {
            box.addView(outlined(getString(R.string.editor_field_show), R.drawable.ic_add, v -> showOnLabel(f)));
        }
        if (f.type == TemplateField.Type.TEXT) {
            TextInputLayout def = input(getString(R.string.editor_field_default), f.defaultValue, false);
            EditText defInput = def.getEditText();
            defInput.addTextChangedListener(watcher(() -> {
                checkpointTyping(defInput);
                f.defaultValue = defInput.getText() == null ? "" : defInput.getText().toString();
                scheduleRefresh();
            }));
            box.addView(def);
            box.addView(toggle(getString(R.string.editor_field_required), f.required, on -> f.required = on));
        } else if (f.type == TemplateField.Type.DURATION) {
            int minutes = Durations.parseMinutes(f.defaultValue);
            box.addView(muted(getString(R.string.editor_field_duration, Durations.format(Math.max(0, minutes)))));
        }
        return card;
    }

    private int fieldKind(TemplateDraft.Field f) {
        switch (f.type) {
            case DATETIME:
                return f.dateOnly ? R.string.editor_kind_date : R.string.editor_kind_datetime;
            case DURATION:
                return R.string.editor_kind_duration;
            default:
                return R.string.editor_kind_text;
        }
    }

    private boolean usedOnLabel(TemplateDraft.Field f) {
        String a = "{{" + f.key + "}";
        String b = "{{" + f.key + "|";
        String c = "{{" + f.key + "+";
        String d = "+" + f.key + "|";
        String e2 = "+" + f.key + "}";
        for (TemplateElement e : draft.elements) {
            for (String text : new String[]{e.text, e.fallbackText}) {
                if (text.contains(a) || text.contains(b) || text.contains(c) || text.contains(d) || text.contains(e2)) {
                    return true;
                }
            }
        }
        return false;
    }

    private String insertCode(TemplateDraft.Field f) {
        if (f.type == TemplateField.Type.DATETIME) return "{{" + f.key + (f.dateOnly ? "|date}}" : "|datetime}}");
        return "{{" + f.key + "}}";
    }

    /** Вывести поле на этикетку строкой «Подпись: значение» и выбрать её. */
    private void showOnLabel(TemplateDraft.Field f) {
        String label = f.label.trim();
        TemplateElement e = LayoutEditing.newText((label.isEmpty() ? "" : label + ": ") + insertCode(f),
                draft.widthMm, draft.heightMm);
        e.h = Math.min(e.h, 4.4f);
        tab = TAB_ELEMENT;
        tabs.check(R.id.editor_tab_element);
        addElement(e);
        Toast.makeText(this, R.string.editor_field_shown, Toast.LENGTH_LONG).show();
    }

    private void askNewField(TemplateField.Type type) {
        View view = LayoutInflater.from(this).inflate(R.layout.editor_input, null);
        TextInputLayout layout = (TextInputLayout) view;
        layout.setHint(R.string.editor_field_label);
        LinearLayout wrap = new LinearLayout(this);
        wrap.setPadding(dp(24), dp(4), dp(24), 0);
        wrap.addView(layout);
        new MaterialAlertDialogBuilder(this)
                .setTitle(type == TemplateField.Type.TEXT ? R.string.editor_add_text_field : R.string.editor_add_date_field)
                .setMessage(R.string.editor_new_field_note)
                .setView(wrap)
                .setPositiveButton(R.string.editor_add, (d, w) -> {
                    EditText input = layout.getEditText();
                    String label = input == null || input.getText() == null ? "" : input.getText().toString().trim();
                    if (label.isEmpty()) label = getString(type == TemplateField.Type.TEXT
                            ? R.string.editor_new_field_text : R.string.editor_new_field_date);
                    checkpoint();
                    TemplateDraft.Field f = new TemplateDraft.Field(draft.newFieldKey(), label, type);
                    if (type == TemplateField.Type.DATETIME) f.defaultValue = "now";
                    draft.fields.add(f);
                    TemplateElement e = LayoutEditing.newText(label + ": " + insertCode(f), draft.widthMm, draft.heightMm);
                    e.h = Math.min(e.h, 4.4f);
                    LayoutEditing.placeFree(draft.elements, e, draft.widthMm, draft.heightMm);
                    draft.elements.add(e);
                    canvas.setSelected(draft.elements.size() - 1);
                    typingTarget = null;
                    tab = TAB_ELEMENT;
                    tabs.check(R.id.editor_tab_element);
                    refreshCanvas();
                    showPanel();
                    Toast.makeText(this, R.string.editor_field_shown, Toast.LENGTH_LONG).show();
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void deleteField(TemplateDraft.Field f) {
        Runnable remove = () -> {
            checkpoint();
            draft.fields.remove(f);
            typingTarget = null;
            refreshCanvas();
            showPanel();
        };
        if (!usedOnLabel(f)) {
            remove.run();
            return;
        }
        new MaterialAlertDialogBuilder(this)
                .setTitle(getString(R.string.editor_field_delete_title, f.label))
                .setMessage(R.string.editor_field_delete_text)
                .setPositiveButton(R.string.editor_delete, (d, w) -> remove.run())
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    // ---------------------------------------------------------------- макет

    private void showLayout() {
        TextInputLayout title = input(getString(R.string.editor_layout_name), draft.title, false);
        EditText titleInput = title.getEditText();
        titleInput.addTextChangedListener(watcher(() -> {
            checkpointTyping(titleInput);
            draft.title = titleInput.getText() == null ? "" : titleInput.getText().toString();
            title.setError(null);
            subtitle.setText(getString(R.string.editor_subtitle, draft.title.trim().isEmpty() ? "—" : draft.title.trim(),
                    MainActivity.formatMm(draft.widthMm), MainActivity.formatMm(draft.heightMm)));
        }));
        title.setTag("title");
        panel.addView(title);
        TextInputLayout description = input(getString(R.string.editor_layout_description), draft.description, true);
        EditText descriptionInput = description.getEditText();
        descriptionInput.addTextChangedListener(watcher(() -> {
            checkpointTyping(descriptionInput);
            draft.description = descriptionInput.getText() == null ? "" : descriptionInput.getText().toString();
        }));
        panel.addView(description);

        panel.addView(section(getString(R.string.editor_layout_size,
                MainActivity.formatMm(draft.widthMm), MainActivity.formatMm(draft.heightMm)), 16));
        ChipGroup sizes = new ChipGroup(this);
        for (int[] size : SIZE_PRESETS) {
            Chip chip = new Chip(this);
            chip.setText(getString(R.string.editor_size_chip, size[0], size[1]));
            chip.setCheckable(true);
            chip.setChecked(size[0] == draft.widthMm && size[1] == draft.heightMm);
            chip.setOnClickListener(v -> resize(size[0], size[1]));
            sizes.addView(chip);
        }
        Chip other = new Chip(this);
        other.setText(R.string.editor_size_other);
        other.setOnClickListener(v -> askSize());
        sizes.addView(other);
        panel.addView(sizes);
        panel.addView(muted(getString(R.string.editor_size_note)));

        if (repo.isBuiltIn(draft.id)) {
            MaterialButton reset = outlined(getString(R.string.editor_reset), R.drawable.ic_undo, v -> confirmReset());
            LinearLayout.LayoutParams lp = (LinearLayout.LayoutParams) reset.getLayoutParams();
            lp.topMargin = dp(16);
            panel.addView(reset);
        }
        panel.addView(muted(getString(R.string.editor_local_note)));
    }

    private void resize(int width, int height) {
        if (width == draft.widthMm && height == draft.heightMm) return;
        checkpoint();
        typingTarget = null;
        LayoutEditing.scaleTo(draft.elements, draft.widthMm, draft.heightMm, width, height);
        draft.widthMm = width;
        draft.heightMm = height;
        refreshCanvas();
        showPanel();
    }

    private void askSize() {
        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.HORIZONTAL);
        wrap.setPadding(dp(24), dp(4), dp(24), 0);
        TextInputLayout w = (TextInputLayout) LayoutInflater.from(this).inflate(R.layout.editor_input, wrap, false);
        TextInputLayout h = (TextInputLayout) LayoutInflater.from(this).inflate(R.layout.editor_input, wrap, false);
        w.setHint(R.string.settings_width);
        h.setHint(R.string.settings_height);
        w.getEditText().setInputType(InputType.TYPE_CLASS_NUMBER);
        h.getEditText().setInputType(InputType.TYPE_CLASS_NUMBER);
        w.getEditText().setText(MainActivity.formatMm(draft.widthMm));
        h.getEditText().setText(MainActivity.formatMm(draft.heightMm));
        wrap.addView(weighted(w));
        View gap = new View(this);
        gap.setLayoutParams(new LinearLayout.LayoutParams(dp(10), 1));
        wrap.addView(gap);
        wrap.addView(weighted(h));
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.editor_size_other)
                .setMessage(getString(R.string.editor_size_limits, LabelSettings.MIN_WIDTH_MM, LabelSettings.MAX_WIDTH_MM,
                        LabelSettings.MIN_HEIGHT_MM, LabelSettings.MAX_HEIGHT_MM))
                .setView(wrap)
                .setPositiveButton(R.string.save, (d, which) -> {
                    int width = clamp(parse(w.getEditText(), (int) draft.widthMm),
                            LabelSettings.MIN_WIDTH_MM, LabelSettings.MAX_WIDTH_MM);
                    int height = clamp(parse(h.getEditText(), (int) draft.heightMm),
                            LabelSettings.MIN_HEIGHT_MM, LabelSettings.MAX_HEIGHT_MM);
                    resize(width, height);
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void confirmReset() {
        LabelTemplate original = repo.original(draft.id);
        if (original == null) return;
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.editor_reset_title)
                .setMessage(R.string.editor_reset_text)
                .setPositiveButton(R.string.editor_reset_confirm, (d, w) -> {
                    checkpoint();
                    draft = TemplateDraft.of(original);
                    canvas.setSelected(-1);
                    typingTarget = null;
                    refreshCanvas();
                    showPanel();
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    // ---------------------------------------------------------------- сохранение и выход

    private boolean dirty() {
        return isNew || !TemplateWriter.write(draft).equals(savedJson);
    }

    void save() {
        if (draft.title.trim().isEmpty()) {
            tabs.check(R.id.editor_tab_layout);
            View title = panel.findViewWithTag("title");
            if (title instanceof TextInputLayout) {
                ((TextInputLayout) title).setError(getString(R.string.editor_title_required));
            }
            return;
        }
        try {
            LabelTemplate template = draft.build();
            repo.save(template);
            savedJson = TemplateWriter.write(draft);
            isNew = false;
            Toast.makeText(this, R.string.editor_saved, Toast.LENGTH_LONG).show();
            setResult(RESULT_OK, new Intent().putExtra(RESULT_ID, template.id));
            finish();
        } catch (IllegalArgumentException e) {
            Ui.message(this, getString(R.string.editor_save_failed), e.getMessage());
        } catch (IOException e) {
            Ui.message(this, getString(R.string.editor_save_failed), getString(R.string.editor_save_io));
        }
    }

    private void leave() {
        if (!dirty()) {
            finish();
            return;
        }
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.editor_leave_title)
                .setMessage(R.string.editor_leave_text)
                .setPositiveButton(R.string.save, (d, w) -> save())
                .setNegativeButton(R.string.editor_discard, (d, w) -> finish())
                .setNeutralButton(R.string.cancel, null)
                .show();
    }

    // ---------------------------------------------------------------- мелочи разметки

    private interface Change {
        void apply(boolean on);
    }

    private interface Step {
        /** Изменить на {@code steps} и вернуть новую подпись значения. */
        String apply(int steps);
    }

    private TextView section(String text, int topDp) {
        TextView view = new TextView(this);
        view.setTextAppearance(R.style.SetupHelper_Section);
        view.setText(text);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(topDp);
        view.setLayoutParams(lp);
        return view;
    }

    private TextView muted(String text) {
        TextView view = new TextView(this);
        view.setTextAppearance(R.style.SetupHelper_Muted);
        view.setText(text);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(6);
        view.setLayoutParams(lp);
        return view;
    }

    private LinearLayout row() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(8);
        row.setLayoutParams(lp);
        return row;
    }

    private <T extends View> T weighted(T view) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        lp.setMarginEnd(dp(6));
        view.setLayoutParams(lp);
        return view;
    }

    private MaterialButton outlined(String text, int icon, View.OnClickListener click) {
        MaterialButton b = new MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle);
        b.setText(text);
        b.setIconResource(icon);
        b.setIconGravity(MaterialButton.ICON_GRAVITY_TEXT_START);
        b.setCornerRadius(dp(14));
        b.setMinHeight(dp(52));
        b.setOnClickListener(click);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(6);
        b.setLayoutParams(lp);
        return b;
    }

    private MaterialButton iconButton(int icon, int description, View.OnClickListener click) {
        MaterialButton b = new MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle);
        b.setIconResource(icon);
        b.setIconGravity(MaterialButton.ICON_GRAVITY_TEXT_START);
        b.setIconPadding(0);
        b.setIconSize(dp(26));
        b.setPadding(0, 0, 0, 0);
        b.setInsetTop(0);
        b.setInsetBottom(0);
        b.setCornerRadius(dp(14));
        b.setMinWidth(dp(52));
        b.setMinimumWidth(dp(52));
        b.setMinHeight(dp(52));
        b.setContentDescription(getString(description));
        b.setOnClickListener(click);
        b.setLayoutParams(new LinearLayout.LayoutParams(dp(52), dp(52)));
        return b;
    }

    private TextInputLayout input(String hint, String value, boolean multiline) {
        TextInputLayout layout = (TextInputLayout) LayoutInflater.from(this).inflate(R.layout.editor_input, panel, false);
        layout.setHint(hint);
        EditText text = layout.getEditText();
        if (multiline) {
            text.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                    | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
            text.setMinLines(2);
        }
        text.setText(value);
        return layout;
    }

    private View stepper(String label, String value, Step step) {
        LinearLayout row = row();
        TextView name = new TextView(this);
        name.setTextAppearance(R.style.SetupHelper_Body);
        name.setText(label);
        name.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(name);
        TextView shown = new TextView(this);
        shown.setTextAppearance(R.style.SetupHelper_Section);
        shown.setGravity(Gravity.CENTER);
        shown.setText(value);
        shown.setLayoutParams(new LinearLayout.LayoutParams(dp(84), LinearLayout.LayoutParams.WRAP_CONTENT));
        row.addView(iconButton(R.drawable.ic_remove, R.string.editor_less, v -> {
            typingTarget = null;
            shown.setText(step.apply(-1));
        }));
        row.addView(shown);
        row.addView(iconButton(R.drawable.ic_add, R.string.editor_more, v -> {
            typingTarget = null;
            shown.setText(step.apply(1));
        }));
        return row;
    }

    private View toggle(String label, boolean value, Change change) {
        MaterialSwitch toggle = new MaterialSwitch(this);
        toggle.setText(label);
        toggle.setTextAppearance(R.style.SetupHelper_Body);
        toggle.setChecked(value);
        toggle.setMinHeight(dp(48));
        toggle.setOnCheckedChangeListener((b, on) -> {
            checkpoint();
            typingTarget = null;
            change.apply(on);
            refreshCanvas();
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(4);
        toggle.setLayoutParams(lp);
        return toggle;
    }

    private static TextWatcher watcher(Runnable onChange) {
        return new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
            }

            @Override
            public void afterTextChanged(Editable s) {
                onChange.run();
            }
        };
    }

    private String mm(float value) {
        return getString(R.string.editor_mm, MainActivity.formatMm(value));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static int parse(EditText input, int fallback) {
        try {
            return Integer.parseInt(input.getText().toString().trim());
        } catch (RuntimeException e) {
            return fallback;
        }
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
