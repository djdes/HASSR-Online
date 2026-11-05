package ru.wesetup.helper;

import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.widget.PopupMenu;
import androidx.core.content.ContextCompat;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.util.List;

import ru.wesetup.helper.template.LabelTemplate;
import ru.wesetup.helper.template.TemplateRepository;

/**
 * «Макеты этикеток»: все макеты с превью и пометкой «Встроенный» / «Изменён на
 * телефоне» / «Свой». Нажать — изменить; ⋮ — копия, вернуть как было, удалить;
 * внизу — новый макет (с чистого листа или копией). Всё — на телефоне, без сети.
 */
public final class LayoutsActivity extends BaseActivity {

    private HelperApp app;
    private TemplateRepository repo;
    private LinearLayout list;
    private int shownVersion = -1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        app = HelperApp.get(this);
        repo = app.templates();
        setContentView(R.layout.activity_layouts);
        Ui.applySystemBarInsets(this, findViewById(R.id.layouts_root));
        list = findViewById(R.id.layouts_list);
        findViewById(R.id.layouts_back).setOnClickListener(v -> finish());
        findViewById(R.id.layouts_new).setOnClickListener(v -> chooseNew());
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (shownVersion != repo.version()) render();
    }

    private void render() {
        shownVersion = repo.version();
        list.removeAllViews();
        LayoutInflater inflater = LayoutInflater.from(this);
        for (LabelTemplate template : repo.all()) {
            View item = inflater.inflate(R.layout.item_layout, list, false);
            ((TextView) item.findViewById(R.id.layout_title)).setText(template.title);
            ((TextView) item.findViewById(R.id.layout_size)).setText(getString(R.string.layouts_size,
                    MainActivity.formatMm(template.widthMm), MainActivity.formatMm(template.heightMm),
                    template.fields.size()));
            TextView badge = item.findViewById(R.id.layout_badge);
            boolean own = !repo.isBuiltIn(template.id);
            boolean modified = repo.isModified(template.id);
            badge.setText(own ? R.string.layouts_badge_own
                    : modified ? R.string.layouts_badge_modified : R.string.layouts_badge_builtin);
            badge.setTextColor(ContextCompat.getColor(this, own || modified ? R.color.brand_dark : R.color.muted));
            ((ImageView) item.findViewById(R.id.layout_preview)).setImageBitmap(LayoutPreview.render(app, template));
            item.setTag(template.id);
            item.setOnClickListener(v -> edit(template.id));
            item.findViewById(R.id.layout_menu).setOnClickListener(v -> showMenu(v, template));
            list.addView(item);
        }
    }

    private void edit(String id) {
        startActivity(new Intent(this, LayoutEditorActivity.class).putExtra(LayoutEditorActivity.EXTRA_ID, id));
    }

    private void copy(String id) {
        startActivity(new Intent(this, LayoutEditorActivity.class).putExtra(LayoutEditorActivity.EXTRA_COPY_OF, id));
    }

    private void chooseNew() {
        String[] options = {getString(R.string.layouts_new_blank), getString(R.string.layouts_new_copy)};
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.layouts_new)
                .setItems(options, (d, which) -> {
                    if (which == 0) {
                        startActivity(new Intent(this, LayoutEditorActivity.class)
                                .putExtra(LayoutEditorActivity.EXTRA_BLANK, true));
                    } else {
                        chooseSource();
                    }
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void chooseSource() {
        List<LabelTemplate> all = repo.all();
        String[] titles = new String[all.size()];
        for (int i = 0; i < all.size(); i++) titles[i] = all.get(i).title;
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.layouts_pick_source)
                .setItems(titles, (d, which) -> copy(all.get(which).id))
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void showMenu(View anchor, LabelTemplate template) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add(0, 1, 0, R.string.layouts_edit);
        menu.getMenu().add(0, 2, 1, R.string.layouts_copy);
        if (repo.isModified(template.id)) menu.getMenu().add(0, 3, 2, R.string.layouts_reset);
        if (!repo.isBuiltIn(template.id)) menu.getMenu().add(0, 4, 3, R.string.layouts_delete);
        menu.setOnMenuItemClickListener(item -> {
            switch (item.getItemId()) {
                case 1:
                    edit(template.id);
                    return true;
                case 2:
                    copy(template.id);
                    return true;
                case 3:
                    confirmReset(template);
                    return true;
                case 4:
                    confirmDelete(template);
                    return true;
                default:
                    return false;
            }
        });
        menu.show();
    }

    void confirmReset(LabelTemplate template) {
        new MaterialAlertDialogBuilder(this)
                .setTitle(getString(R.string.layouts_reset_title, template.title))
                .setMessage(R.string.layouts_reset_text)
                .setPositiveButton(R.string.editor_reset_confirm, (d, w) -> {
                    repo.reset(template.id);
                    render();
                    Toast.makeText(this, R.string.layouts_reset_done, Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    void confirmDelete(LabelTemplate template) {
        new MaterialAlertDialogBuilder(this)
                .setTitle(getString(R.string.layouts_delete_title, template.title))
                .setMessage(R.string.layouts_delete_text)
                .setPositiveButton(R.string.layouts_delete, (d, w) -> {
                    repo.reset(template.id);
                    render();
                    Toast.makeText(this, R.string.layouts_deleted, Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }
}
