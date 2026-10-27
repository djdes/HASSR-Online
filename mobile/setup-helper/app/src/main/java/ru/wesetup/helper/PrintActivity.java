package ru.wesetup.helper;

import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.drawable.BitmapDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputFilter;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.ContextCompat;

import com.google.android.material.chip.Chip;
import com.google.android.material.chip.ChipGroup;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.textfield.MaterialAutoCompleteTextView;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;

import java.util.Calendar;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import ru.wesetup.helper.bt.PrinterInfo;
import ru.wesetup.helper.bt.PrinterManager;
import ru.wesetup.helper.print.LabelRenderer;
import ru.wesetup.helper.print.MonoBitmap;
import ru.wesetup.helper.print.Tspl;
import ru.wesetup.helper.template.Durations;
import ru.wesetup.helper.template.LabelTemplate;
import ru.wesetup.helper.template.TemplateField;
import ru.wesetup.helper.template.TemplateValues;

/**
 * Печать по шаблону: выбрать шаблон, заполнить поля, посмотреть этикетку
 * (ровно те точки, что уйдут на принтер) и напечатать нужное число копий.
 * «История» — прошлые печати: повторить одним нажатием или поправить.
 */
public final class PrintActivity extends BaseActivity {

    static final String EXTRA_ADDRESS = "address";
    static final String EXTRA_TEMPLATE = "template";

    private HelperApp app;
    private PrinterInfo printer;
    /** Открыли без принтера: шаблоны и предпросмотр, печать — после подключения. */
    private boolean previewOnly;
    private LabelTemplate template;
    private ChipGroup chips;
    private HorizontalScrollView templatesScroll;
    private View templatesPrev;
    private View templatesNext;
    private PrintHistory history;
    private TextView description;
    private ImageView preview;
    private LinearLayout fieldsView;
    private TextView copiesView;
    private int copies = 1;
    private long openedAt;

    private final Map<String, TextInputLayout> textLayouts = new HashMap<>();
    private final Map<String, EditText> textInputs = new HashMap<>();
    private final Map<String, Long> times = new HashMap<>();
    private final Map<String, Integer> durations = new HashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable refresh = this::updatePreview;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        app = HelperApp.get(this);
        String address = getIntent().getStringExtra(EXTRA_ADDRESS);
        previewOnly = address == null;
        printer = previewOnly ? previewPrinter() : app.printerStore().get(address);
        if (printer == null || app.sessions().load() == null) {
            finish();
            return;
        }
        setContentView(R.layout.activity_print);
        Ui.applySystemBarInsets(this, findViewById(R.id.print_root));
        openedAt = System.currentTimeMillis();

        history = new PrintHistory(this);
        chips = findViewById(R.id.print_templates);
        templatesScroll = findViewById(R.id.print_templates_scroll);
        templatesPrev = findViewById(R.id.print_templates_prev);
        templatesNext = findViewById(R.id.print_templates_next);
        description = findViewById(R.id.print_description);
        preview = findViewById(R.id.print_preview);
        fieldsView = findViewById(R.id.print_fields);
        copiesView = findViewById(R.id.print_copies);
        ((TextView) findViewById(R.id.print_printer)).setText(previewOnly ? getString(R.string.print_preview_only)
                : getString(R.string.printer_details, printer.displayName(),
                getString(R.string.printer_label, printer.label.sizeLabel(), MainActivity.formatMm(printer.label.gapMm))));

        findViewById(R.id.print_back).setOnClickListener(v -> finish());
        findViewById(R.id.print_minus).setOnClickListener(v -> setCopies(copies - 1));
        findViewById(R.id.print_plus).setOnClickListener(v -> setCopies(copies + 1));
        findViewById(R.id.print_submit).setOnClickListener(v -> print());
        findViewById(R.id.print_history).setOnClickListener(v -> showHistory());
        // Стрелки листают шаблоны на две трети ширины; у края стрелка гаснет.
        templatesPrev.setOnClickListener(v -> templatesScroll.smoothScrollBy(-templatesScroll.getWidth() * 2 / 3, 0));
        templatesNext.setOnClickListener(v -> templatesScroll.smoothScrollBy(templatesScroll.getWidth() * 2 / 3, 0));
        templatesScroll.setOnScrollChangeListener((v, x, y, oldX, oldY) -> updateArrows());

        List<LabelTemplate> templates = app.templates().all();
        // Выбранный шаблон — заливкой и синей рамкой, остальные — белые.
        int[][] states = {{android.R.attr.state_checked}, {}};
        ColorStateList chipBackground = new ColorStateList(states, new int[]{
                ContextCompat.getColor(this, R.color.brand_soft), ContextCompat.getColor(this, R.color.card)});
        ColorStateList chipStroke = new ColorStateList(states, new int[]{
                ContextCompat.getColor(this, R.color.brand), ContextCompat.getColor(this, R.color.border)});
        ColorStateList chipText = new ColorStateList(states, new int[]{
                ContextCompat.getColor(this, R.color.brand_dark), ContextCompat.getColor(this, R.color.ink)});
        String initial = getIntent().getStringExtra(EXTRA_TEMPLATE);
        LabelTemplate selected = null;
        for (LabelTemplate t : templates) {
            Chip chip = new Chip(this);
            chip.setText(t.title);
            chip.setCheckable(true);
            chip.setCheckedIconVisible(false);
            // Крупно, чтобы попадать пальцем: высота 56 dp, текст 16 sp.
            chip.setChipMinHeight(dp(56));
            chip.setTextSize(16);
            chip.setChipStartPadding(dp(10));
            chip.setChipEndPadding(dp(10));
            chip.setChipCornerRadius(dp(16));
            chip.setChipBackgroundColor(chipBackground);
            chip.setChipStrokeColor(chipStroke);
            chip.setChipStrokeWidth(dp(2));
            chip.setTextColor(chipText);
            chip.setTag(t.id);
            chip.setOnClickListener(v -> select(t));
            chips.addView(chip);
            boolean pick = initial != null ? t.id.equals(initial) : selected == null && !LabelTemplate.TEST_ID.equals(t.id);
            if (pick) {
                selected = t;
                chip.setChecked(true);
            }
        }
        if (selected == null && !templates.isEmpty()) {
            selected = templates.get(0);
            ((Chip) chips.getChildAt(0)).setChecked(true);
        }
        if (selected != null) select(selected);
        setCopies(1);
        final String shown = selected == null ? null : selected.id;
        templatesScroll.post(() -> {
            scrollToTemplate(shown, false);
            updateArrows();
        });
    }

    /** Принтер «по умолчанию» для предпросмотра: этикетка 58×40, как у AIYIN IP-802BT. */
    private PrinterInfo previewPrinter() {
        PrinterInfo preview = new PrinterInfo("");
        preview.name = getString(R.string.print_no_printer);
        return preview;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    /** Показать кнопку шаблона в ленте — чтобы выбранный был виден, а не за краем. */
    private void scrollToTemplate(String id, boolean smooth) {
        if (id == null) return;
        for (int i = 0; i < chips.getChildCount(); i++) {
            View chip = chips.getChildAt(i);
            if (id.equals(chip.getTag())) {
                int x = Math.max(0, chip.getLeft() - dp(16));
                if (smooth) templatesScroll.smoothScrollTo(x, 0);
                else templatesScroll.scrollTo(x, 0);
                return;
            }
        }
    }

    private void updateArrows() {
        boolean back = templatesScroll.canScrollHorizontally(-1);
        boolean forward = templatesScroll.canScrollHorizontally(1);
        templatesPrev.setEnabled(back);
        templatesPrev.setAlpha(back ? 1f : 0.35f);
        templatesNext.setEnabled(forward);
        templatesNext.setAlpha(forward ? 1f : 0.35f);
    }

    private void select(LabelTemplate next) {
        select(next, null);
    }

    /** {@code from} — запись истории: поля заполняются её значениями. */
    private void select(LabelTemplate next, PrintHistory.Entry from) {
        rememberTexts();
        template = next;
        description.setText(next.description);
        fieldsView.removeAllViews();
        textLayouts.clear();
        textInputs.clear();
        times.clear();
        durations.clear();
        SharedPreferences remembered = getSharedPreferences(PrintJobs.VALUES_PREFS, MODE_PRIVATE);
        TemplateValues base = PrintJobs.baseValues(app, printer, openedAt);
        LayoutInflater inflater = LayoutInflater.from(this);
        for (TemplateField field : next.fields) {
            switch (field.type) {
                case TEXT: {
                    String value = from != null && from.texts.containsKey(field.key) ? from.texts.get(field.key)
                            : remembered.getString(rememberKey(field), base.resolve(field.defaultValue));
                    addTextField(inflater, field, value);
                    break;
                }
                case DATETIME:
                    times.put(field.key, from != null && from.times.containsKey(field.key) ? from.times.get(field.key)
                            : TemplateValues.defaultTime(field.defaultValue, openedAt));
                    addDateField(inflater, field);
                    break;
                case DURATION:
                    durations.put(field.key, from != null && from.durations.containsKey(field.key)
                            ? from.durations.get(field.key) : Durations.parseMinutes(field.defaultValue));
                    addDurationField(inflater, field);
                    break;
                default:
                    break;
            }
        }
        updatePreview();
    }

    private void addTextField(LayoutInflater inflater, TemplateField field, String value) {
        boolean withOptions = !field.options.isEmpty();
        TextInputLayout layout = (TextInputLayout) inflater.inflate(
                withOptions ? R.layout.field_text_options : R.layout.field_text, fieldsView, false);
        EditText input = layout.findViewById(R.id.field_input);
        layout.setHint(field.label);
        if (withOptions) {
            // Варианты — подсказки: можно выбрать из списка или вписать своё.
            ((MaterialAutoCompleteTextView) input).setSimpleItems(field.options.toArray(new String[0]));
        } else {
            layout.setCounterMaxLength(field.maxLength);
        }
        if (!field.hint.isEmpty()) layout.setPlaceholderText(field.hint);
        input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(field.maxLength)});
        if (field.multiline) {
            input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                    | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
            input.setMinLines(2);
        }
        if (withOptions) {
            ((MaterialAutoCompleteTextView) input).setText(value, false);
        } else {
            input.setText(value);
        }
        input.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                layout.setError(null);
            }

            @Override
            public void afterTextChanged(Editable s) {
                schedulePreview();
            }
        });
        textLayouts.put(field.key, layout);
        textInputs.put(field.key, input);
        fieldsView.addView(layout);
    }

    private void addDateField(LayoutInflater inflater, TemplateField field) {
        TextInputLayout layout = (TextInputLayout) inflater.inflate(R.layout.field_datetime, fieldsView, false);
        TextInputEditText input = layout.findViewById(R.id.field_input);
        layout.setHint(field.label);
        input.setText(field.dateOnly ? Ui.date(times.get(field.key)) : Ui.dateTime(times.get(field.key)));
        View.OnClickListener pick = v -> pickDateTime(field.key, field.dateOnly, input);
        input.setOnClickListener(pick);
        layout.setEndIconOnClickListener(pick);
        fieldsView.addView(layout);
    }

    private void addDurationField(LayoutInflater inflater, TemplateField field) {
        TextInputLayout layout = (TextInputLayout) inflater.inflate(R.layout.field_duration, fieldsView, false);
        MaterialAutoCompleteTextView input = layout.findViewById(R.id.field_input);
        layout.setHint(field.label);
        List<String> options = field.options.isEmpty()
                ? java.util.Collections.singletonList(field.defaultValue) : field.options;
        String[] labels = new String[options.size()];
        for (int i = 0; i < options.size(); i++) labels[i] = Durations.format(Durations.parseMinutes(options.get(i)));
        input.setSimpleItems(labels);
        input.setText(Durations.format(durations.get(field.key)), false);
        input.setOnItemClickListener((parent, view, position, id) -> {
            durations.put(field.key, Durations.parseMinutes(options.get(position)));
            updatePreview();
        });
        fieldsView.addView(layout);
    }

    private void pickDateTime(String key, boolean dateOnly, TextInputEditText input) {
        Calendar calendar = Calendar.getInstance();
        Long current = times.get(key);
        if (current != null) calendar.setTimeInMillis(current);
        new DatePickerDialog(this, (view, year, month, day) -> {
            calendar.set(year, month, day);
            if (dateOnly) {
                // Время на такой этикетке не печатается — остаётся прежним.
                times.put(key, calendar.getTimeInMillis());
                input.setText(Ui.date(calendar.getTimeInMillis()));
                updatePreview();
                return;
            }
            new TimePickerDialog(this, (timeView, hour, minute) -> {
                calendar.set(Calendar.HOUR_OF_DAY, hour);
                calendar.set(Calendar.MINUTE, minute);
                calendar.set(Calendar.SECOND, 0);
                times.put(key, calendar.getTimeInMillis());
                input.setText(Ui.dateTime(calendar.getTimeInMillis()));
                updatePreview();
            }, calendar.get(Calendar.HOUR_OF_DAY), calendar.get(Calendar.MINUTE), true).show();
        }, calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH), calendar.get(Calendar.DAY_OF_MONTH)).show();
    }

    private TemplateValues values() {
        TemplateValues values = PrintJobs.baseValues(app, printer, System.currentTimeMillis());
        for (Map.Entry<String, EditText> entry : textInputs.entrySet()) {
            Editable text = entry.getValue().getText();
            values.text(entry.getKey(), text == null ? "" : text.toString().trim());
        }
        for (Map.Entry<String, Long> entry : times.entrySet()) values.time(entry.getKey(), entry.getValue());
        for (Map.Entry<String, Integer> entry : durations.entrySet()) values.duration(entry.getKey(), entry.getValue());
        return values;
    }

    private void schedulePreview() {
        main.removeCallbacks(refresh);
        main.postDelayed(refresh, 200);
    }

    private void updatePreview() {
        if (template == null) return;
        MonoBitmap image = PrintJobs.render(app, template, printer.label, values());
        Bitmap bitmap = LabelRenderer.preview(image);
        BitmapDrawable drawable = new BitmapDrawable(getResources(), bitmap);
        // Без сглаживания: на экране видны те же точки, что напечатает принтер.
        drawable.setFilterBitmap(false);
        drawable.setAntiAlias(false);
        preview.setImageDrawable(drawable);
    }

    private void setCopies(int value) {
        copies = Math.max(1, Math.min(Tspl.MAX_COPIES, value));
        copiesView.setText(String.valueOf(copies));
    }

    private void print() {
        if (template == null) return;
        for (TemplateField field : template.fields) {
            if (field.type != TemplateField.Type.TEXT || !field.required) continue;
            EditText input = textInputs.get(field.key);
            Editable text = input == null ? null : input.getText();
            if (text == null || text.toString().trim().isEmpty()) {
                TextInputLayout layout = textLayouts.get(field.key);
                if (layout != null) layout.setError(getString(R.string.print_required, field.label));
                if (input != null) input.requestFocus();
                return;
            }
        }
        rememberTexts();
        send(template, values(), copies, snapshot(template, copies));
    }

    /** Значения полей сейчас — для истории. */
    private PrintHistory.Entry snapshot(LabelTemplate current, int count) {
        Map<String, String> texts = new LinkedHashMap<>();
        for (TemplateField field : current.fields) {
            EditText input = textInputs.get(field.key);
            if (input != null && input.getText() != null) texts.put(field.key, input.getText().toString().trim());
        }
        return new PrintHistory.Entry(current.id, current.title, count, System.currentTimeMillis(),
                texts, times, durations);
    }

    private void send(LabelTemplate current, TemplateValues values, int count, PrintHistory.Entry record) {
        if (previewOnly) {
            Ui.message(this, current.title, getString(R.string.print_need_printer));
            return;
        }
        withBluetooth(false, () -> {
            Ui.Progress progress = new Ui.Progress(this, current.title, null);
            progress.update(getString(R.string.print_sending));
            PrintJobs.print(app, printer, current, values, count, progress::update, new PrinterManager.Callback<Void>() {
                @Override
                public void onSuccess(Void value) {
                    progress.dismiss();
                    history.add(new PrintHistory.Entry(record.templateId, record.templateTitle, count,
                            System.currentTimeMillis(), record.texts, record.times, record.durations));
                    Toast.makeText(PrintActivity.this, getString(R.string.print_done_copies, count),
                            Toast.LENGTH_SHORT).show();
                }

                @Override
                public void onError(String message) {
                    progress.dismiss();
                    if (!isFinishing()) Ui.message(PrintActivity.this, current.title, message);
                }
            });
        });
    }

    private void showHistory() {
        List<PrintHistory.Entry> entries = history.all();
        if (entries.isEmpty()) {
            Ui.message(this, getString(R.string.history_title), getString(R.string.history_empty));
            return;
        }
        String[] lines = new String[entries.size()];
        for (int i = 0; i < entries.size(); i++) {
            PrintHistory.Entry e = entries.get(i);
            // «Маркировка продукта» / «Салат «Цезарь»» / «4 шт. · 25.10.2026 11:30».
            String summary = e.summary();
            lines[i] = e.templateTitle + "\n" + (summary.isEmpty() ? "" : summary + "\n")
                    + getString(R.string.history_line, e.copies, Ui.dateTime(e.printedAt));
        }
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, R.layout.item_history, R.id.history_text, lines);
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.history_title)
                .setAdapter(adapter, (dialog, which) -> openHistoryEntry(entries.get(which)))
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void openHistoryEntry(PrintHistory.Entry entry) {
        LabelTemplate saved = app.templates().byId(entry.templateId);
        if (saved == null) {
            Toast.makeText(this, R.string.history_template_missing, Toast.LENGTH_LONG).show();
            return;
        }
        String summary = entry.summary();
        String details = getString(R.string.history_details, Ui.dateTime(entry.printedAt), entry.copies);
        new MaterialAlertDialogBuilder(this)
                .setTitle(entry.templateTitle)
                .setMessage(summary.isEmpty() ? details : summary + "\n" + details)
                .setPositiveButton(R.string.history_repeat, (d, w) -> reprint(saved, entry))
                .setNeutralButton(R.string.history_edit, (d, w) -> editFromHistory(saved, entry))
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    /** Ровно та же этикетка: те же тексты, даты и число копий. */
    void reprint(LabelTemplate saved, PrintHistory.Entry entry) {
        TemplateValues values = PrintJobs.baseValues(app, printer, System.currentTimeMillis());
        for (Map.Entry<String, String> e : entry.texts.entrySet()) values.text(e.getKey(), e.getValue());
        for (Map.Entry<String, Long> e : entry.times.entrySet()) values.time(e.getKey(), e.getValue());
        for (Map.Entry<String, Integer> e : entry.durations.entrySet()) values.duration(e.getKey(), e.getValue());
        send(saved, values, entry.copies, entry);
    }

    /** Открыть шаблон с полями из истории: поправить и напечатать. */
    void editFromHistory(LabelTemplate saved, PrintHistory.Entry entry) {
        for (int i = 0; i < chips.getChildCount(); i++) {
            View chip = chips.getChildAt(i);
            if (saved.id.equals(chip.getTag())) ((Chip) chip).setChecked(true);
        }
        templatesScroll.post(() -> scrollToTemplate(saved.id, true));
        select(saved, entry);
        setCopies(entry.copies);
    }

    /** Тексты, кроме подставленных по умолчанию, запоминаются для следующего раза. */
    private void rememberTexts() {
        if (template == null || textInputs.isEmpty()) return;
        SharedPreferences.Editor editor = getSharedPreferences(PrintJobs.VALUES_PREFS, MODE_PRIVATE).edit();
        for (TemplateField field : template.fields) {
            EditText input = textInputs.get(field.key);
            if (input == null || input.getText() == null) continue;
            editor.putString(rememberKey(field), input.getText().toString());
        }
        editor.apply();
    }

    private String rememberKey(TemplateField field) {
        return template.id + "." + field.key;
    }

    @Override
    protected void onPause() {
        super.onPause();
        rememberTexts();
    }
}
