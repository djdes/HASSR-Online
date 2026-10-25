package ru.wesetup.helper;

import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.SharedPreferences;
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
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.google.android.material.chip.Chip;
import com.google.android.material.chip.ChipGroup;
import com.google.android.material.textfield.MaterialAutoCompleteTextView;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;

import java.util.Calendar;
import java.util.HashMap;
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
 */
public final class PrintActivity extends BaseActivity {

    static final String EXTRA_ADDRESS = "address";
    static final String EXTRA_TEMPLATE = "template";

    private HelperApp app;
    private PrinterInfo printer;
    private LabelTemplate template;
    private ChipGroup chips;
    private TextView description;
    private ImageView preview;
    private LinearLayout fieldsView;
    private TextView copiesView;
    private int copies = 1;
    private long openedAt;

    private final Map<String, TextInputLayout> textLayouts = new HashMap<>();
    private final Map<String, TextInputEditText> textInputs = new HashMap<>();
    private final Map<String, Long> times = new HashMap<>();
    private final Map<String, Integer> durations = new HashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable refresh = this::updatePreview;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        app = HelperApp.get(this);
        printer = app.printerStore().get(getIntent().getStringExtra(EXTRA_ADDRESS));
        if (printer == null || app.sessions().load() == null) {
            finish();
            return;
        }
        setContentView(R.layout.activity_print);
        Ui.applySystemBarInsets(this, findViewById(R.id.print_root));
        openedAt = System.currentTimeMillis();

        chips = findViewById(R.id.print_templates);
        description = findViewById(R.id.print_description);
        preview = findViewById(R.id.print_preview);
        fieldsView = findViewById(R.id.print_fields);
        copiesView = findViewById(R.id.print_copies);
        ((TextView) findViewById(R.id.print_printer)).setText(getString(R.string.printer_details, printer.displayName(),
                getString(R.string.printer_label, printer.label.sizeLabel(), MainActivity.formatMm(printer.label.gapMm))));

        findViewById(R.id.print_back).setOnClickListener(v -> finish());
        findViewById(R.id.print_minus).setOnClickListener(v -> setCopies(copies - 1));
        findViewById(R.id.print_plus).setOnClickListener(v -> setCopies(copies + 1));
        findViewById(R.id.print_submit).setOnClickListener(v -> print());

        List<LabelTemplate> templates = app.templates().all();
        String initial = getIntent().getStringExtra(EXTRA_TEMPLATE);
        LabelTemplate selected = null;
        for (LabelTemplate t : templates) {
            Chip chip = new Chip(this);
            chip.setText(t.title);
            chip.setCheckable(true);
            chip.setCheckedIconVisible(false);
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
    }

    private void select(LabelTemplate next) {
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
                case TEXT:
                    addTextField(inflater, field, remembered.getString(rememberKey(field), base.resolve(field.defaultValue)));
                    break;
                case DATETIME:
                    times.put(field.key, TemplateValues.defaultTime(field.defaultValue, openedAt));
                    addDateField(inflater, field);
                    break;
                case DURATION:
                    durations.put(field.key, Durations.parseMinutes(field.defaultValue));
                    addDurationField(inflater, field);
                    break;
                default:
                    break;
            }
        }
        updatePreview();
    }

    private void addTextField(LayoutInflater inflater, TemplateField field, String value) {
        TextInputLayout layout = (TextInputLayout) inflater.inflate(R.layout.field_text, fieldsView, false);
        TextInputEditText input = layout.findViewById(R.id.field_input);
        layout.setHint(field.label);
        layout.setCounterMaxLength(field.maxLength);
        if (!field.hint.isEmpty()) layout.setPlaceholderText(field.hint);
        input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(field.maxLength)});
        if (field.multiline) {
            input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                    | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
            input.setMinLines(2);
        }
        input.setText(value);
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
        input.setText(Ui.dateTime(times.get(field.key)));
        View.OnClickListener pick = v -> pickDateTime(field.key, input);
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

    private void pickDateTime(String key, TextInputEditText input) {
        Calendar calendar = Calendar.getInstance();
        Long current = times.get(key);
        if (current != null) calendar.setTimeInMillis(current);
        new DatePickerDialog(this, (view, year, month, day) -> {
            calendar.set(year, month, day);
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
        for (Map.Entry<String, TextInputEditText> entry : textInputs.entrySet()) {
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
        MonoBitmap image = PrintJobs.render(template, printer.label, values());
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
            TextInputEditText input = textInputs.get(field.key);
            Editable text = input == null ? null : input.getText();
            if (text == null || text.toString().trim().isEmpty()) {
                TextInputLayout layout = textLayouts.get(field.key);
                if (layout != null) layout.setError(getString(R.string.print_required, field.label));
                if (input != null) input.requestFocus();
                return;
            }
        }
        rememberTexts();
        LabelTemplate current = template;
        TemplateValues values = values();
        int count = copies;
        withBluetooth(false, () -> {
            Ui.Progress progress = new Ui.Progress(this, current.title, null);
            progress.update(getString(R.string.print_sending));
            PrintJobs.print(app, printer, current, values, count, progress::update, new PrinterManager.Callback<Void>() {
                @Override
                public void onSuccess(Void value) {
                    progress.dismiss();
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

    /** Тексты, кроме подставленных по умолчанию, запоминаются для следующего раза. */
    private void rememberTexts() {
        if (template == null || textInputs.isEmpty()) return;
        SharedPreferences.Editor editor = getSharedPreferences(PrintJobs.VALUES_PREFS, MODE_PRIVATE).edit();
        for (TemplateField field : template.fields) {
            TextInputEditText input = textInputs.get(field.key);
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
