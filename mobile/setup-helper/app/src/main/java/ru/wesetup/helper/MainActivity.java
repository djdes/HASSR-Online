package ru.wesetup.helper;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.widget.PopupMenu;
import androidx.core.content.ContextCompat;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.materialswitch.MaterialSwitch;

import java.io.IOException;
import java.util.List;
import java.util.Locale;

import ru.wesetup.helper.auth.SessionStore;
import ru.wesetup.helper.bt.PrinterInfo;
import ru.wesetup.helper.bt.PrinterManager;
import ru.wesetup.helper.net.HelperEvents;
import ru.wesetup.helper.net.NetworkState;
import ru.wesetup.helper.net.SyncManager;
import ru.wesetup.helper.print.LabelSettings;
import ru.wesetup.helper.print.Tspl;
import ru.wesetup.helper.template.LabelTemplate;
import ru.wesetup.helper.update.UpdateInfo;
import ru.wesetup.helper.update.Updater;

/**
 * Главный экран: кнопка «Добавить оборудование» и подключённые принтеры с
 * пробной этикеткой. Открывается без сети: всё нужное лежит на телефоне.
 * Плашка сверху — про новую версию приложения, если она есть.
 */
public final class MainActivity extends BaseActivity implements SyncManager.Listener, Updater.Listener {

    private HelperApp app;
    private TextView org;
    private TextView user;
    private View status;
    private ImageView statusIcon;
    private TextView statusText;
    private TextView pending;
    private TextView empty;
    private LinearLayout printersList;
    private View updateCard;
    private View templatesButton;
    private TextView updateText;
    private TextView updateNotes;
    private MaterialButton updateAction;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        app = HelperApp.get(this);
        if (app.sessions().load() == null) {
            openLogin(null);
            return;
        }
        setContentView(R.layout.activity_main);
        Ui.applySystemBarInsets(this, findViewById(R.id.main_root));

        org = findViewById(R.id.main_org);
        user = findViewById(R.id.main_user);
        status = findViewById(R.id.main_status);
        statusIcon = findViewById(R.id.main_status_icon);
        statusText = findViewById(R.id.main_status_text);
        pending = findViewById(R.id.main_pending);
        empty = findViewById(R.id.main_empty);
        printersList = findViewById(R.id.main_printers);
        updateCard = findViewById(R.id.main_update);
        updateText = findViewById(R.id.main_update_text);
        updateNotes = findViewById(R.id.main_update_notes);
        updateAction = findViewById(R.id.main_update_action);

        templatesButton = findViewById(R.id.main_templates);
        // Шаблоны и предпросмотр — и без принтера (например, до его покупки).
        templatesButton.setOnClickListener(v -> startActivity(new Intent(this, PrintActivity.class)));
        MaterialButton add = findViewById(R.id.main_add);
        add.setOnClickListener(v -> withBluetooth(true, () -> startActivity(new Intent(this, ScanActivity.class))));
        findViewById(R.id.main_menu).setOnClickListener(this::showMenu);
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (app.sessions().load() == null) return;
        app.sync().addListener(this);
        app.sync().requestSync();
        if (!BuildConfig.SELF_UPDATE) return;
        app.updater().addListener(this);
        // Не чаще раза в 30 минут и только при сети — иначе ни одного запроса.
        app.updater().checkAsync(false, null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (app.sessions().load() == null) {
            openLogin(null);
            return;
        }
        render();
        if (BuildConfig.SELF_UPDATE && app.updater().takeJustUpdated()) {
            Toast.makeText(this, getString(R.string.updated_toast, BuildConfig.VERSION_NAME), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        app.sync().removeListener(this);
        app.updater().removeListener(this);
    }

    @Override
    public void onUpdateStateChanged() {
        if (!isFinishing()) renderUpdate();
    }

    @Override
    public void onSyncStateChanged() {
        if (!isFinishing()) renderStatus();
    }

    @Override
    public void onSessionRevoked(String message) {
        openLogin(getString(R.string.login_revoked));
    }

    private void render() {
        SessionStore.Session session = app.sessions().load();
        if (session == null) return;
        org.setText(session.orgName.isEmpty() ? getString(R.string.app_name) : session.orgName);
        user.setText(session.email.isEmpty() ? session.userName : session.userName + " · " + session.email);
        renderStatus();
        renderUpdate();
        renderPrinters();
    }

    /** Плашка обновления: что происходит и что нажать — если вообще нужно. */
    private void renderUpdate() {
        if (updateCard == null) return;
        // Вариант для Google Play: обновляет магазин, плашки нет.
        if (!BuildConfig.SELF_UPDATE) {
            updateCard.setVisibility(View.GONE);
            return;
        }
        Updater updater = app.updater();
        Updater.State state = updater.state();
        UpdateInfo info = updater.store().available();
        if (state == Updater.State.NONE || info == null) {
            updateCard.setVisibility(View.GONE);
            return;
        }
        updateCard.setVisibility(View.VISIBLE);
        String name = info.versionName;
        String text;
        int action = 0;
        switch (state) {
            case PENDING:
                text = getString(R.string.update_pending, name);
                break;
            case DOWNLOADING:
                text = getString(R.string.update_downloading, name);
                break;
            case READY_AUTO:
                text = getString(R.string.update_ready_auto, name);
                action = R.string.update_install_now;
                break;
            case NEEDS_CONFIRMATION:
                text = getString(R.string.update_needs_confirmation, name);
                action = R.string.update_install;
                break;
            case NEEDS_PERMISSION:
                text = getString(R.string.update_needs_permission, name);
                action = R.string.update_allow;
                break;
            case INSTALLING:
                text = getString(R.string.update_installing, name);
                break;
            default:
                String error = updater.store().lastError();
                text = getString(R.string.update_failed, name, error == null ? "" : error);
                action = R.string.update_retry;
        }
        updateText.setText(text);
        boolean showNotes = !info.notes.isEmpty() && state != Updater.State.FAILED;
        updateNotes.setVisibility(showNotes ? View.VISIBLE : View.GONE);
        if (showNotes) updateNotes.setText(getString(R.string.update_notes, info.notes));
        updateAction.setVisibility(action == 0 ? View.GONE : View.VISIBLE);
        if (action != 0) {
            updateAction.setText(action);
            final Updater.State clicked = state;
            updateAction.setOnClickListener(v -> onUpdateAction(clicked));
        }
    }

    private void onUpdateAction(Updater.State state) {
        switch (state) {
            case NEEDS_PERMISSION:
                // «Установка неизвестных приложений» для «Сетап помощника» — один раз.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    try {
                        startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getPackageName())));
                    } catch (ActivityNotFoundException e) {
                        Ui.message(this, getString(R.string.app_name), getString(R.string.update_needs_permission,
                                BuildConfig.VERSION_NAME));
                    }
                }
                break;
            case FAILED:
                if (app.updater().isDownloaded()) {
                    app.updater().installAsync(true);
                } else {
                    app.updater().checkAsync(true, this::showCheckResult);
                }
                break;
            default:
                app.updater().installAsync(true);
        }
    }

    private void showCheckResult(Updater.CheckResult result) {
        if (isFinishing()) return;
        int message;
        switch (result) {
            case OFFLINE:
                message = R.string.update_check_offline;
                break;
            case UP_TO_DATE:
                message = R.string.update_check_latest;
                break;
            case READY:
                message = R.string.update_check_found;
                break;
            default:
                message = R.string.update_check_failed;
        }
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
        renderUpdate();
    }

    private void renderStatus() {
        if (statusText == null) return;
        boolean online = NetworkState.isOnline(this);
        int count = app.sync().pending();
        statusIcon.setImageResource(online ? R.drawable.ic_cloud_done : R.drawable.ic_cloud_off);
        int tint = ContextCompat.getColor(this, online ? R.color.success : R.color.muted);
        statusIcon.setImageTintList(ColorStateList.valueOf(tint));
        status.setBackgroundTintList(ColorStateList.valueOf(
                ContextCompat.getColor(this, online ? R.color.success_soft : R.color.page)));
        statusText.setText(online ? (count == 0 && !app.printerStore().all().isEmpty()
                ? getString(R.string.main_synced) : getString(R.string.main_online))
                : getString(R.string.main_offline));
        if (count > 0) {
            pending.setVisibility(View.VISIBLE);
            String text = getString(R.string.main_pending, count);
            String error = app.sync().lastError();
            pending.setText(online && error != null ? text + " — " + error : text);
        } else {
            pending.setVisibility(View.GONE);
        }
    }

    private void renderPrinters() {
        List<PrinterInfo> printers = app.printerStore().all();
        printersList.removeAllViews();
        templatesButton.setVisibility(printers.isEmpty() ? View.VISIBLE : View.GONE);
        empty.setVisibility(printers.isEmpty() ? View.VISIBLE : View.GONE);
        LayoutInflater inflater = LayoutInflater.from(this);
        for (PrinterInfo printer : printers) {
            View item = inflater.inflate(R.layout.item_printer, printersList, false);
            ((TextView) item.findViewById(R.id.printer_name)).setText(printer.displayName());
            String transport = getString(PrinterInfo.TRANSPORT_BLE.equals(printer.transport)
                    ? R.string.transport_ble : R.string.transport_classic);
            String model = printer.model == null ? printer.address : printer.model;
            ((TextView) item.findViewById(R.id.printer_details))
                    .setText(getString(R.string.printer_details, model, transport));
            ((TextView) item.findViewById(R.id.printer_label)).setText(getString(R.string.printer_label,
                    printer.label.sizeLabel(), formatMm(printer.label.gapMm)));
            TextView last = item.findViewById(R.id.printer_last);
            if (printer.lastPrintAt > 0) {
                last.setVisibility(View.VISIBLE);
                last.setText(getString(R.string.printer_last_print, Ui.dateTime(printer.lastPrintAt)));
            }
            MaterialButton test = item.findViewById(R.id.printer_test);
            test.setText(printer.label.widthMm == 58 && printer.label.heightMm == 40
                    ? getString(R.string.printer_test)
                    : getString(R.string.printer_test_size, printer.label.sizeLabel()));
            test.setOnClickListener(v -> printTest(printer));
            item.findViewById(R.id.printer_templates).setOnClickListener(v -> {
                Intent intent = new Intent(this, PrintActivity.class);
                intent.putExtra(PrintActivity.EXTRA_ADDRESS, printer.address);
                startActivity(intent);
            });
            item.findViewById(R.id.printer_menu).setOnClickListener(v -> showPrinterMenu(v, printer));
            printersList.addView(item);
        }
    }

    private void printTest(PrinterInfo printer) {
        LabelTemplate template = app.templates().byId(LabelTemplate.TEST_ID);
        if (template == null) return;
        withBluetooth(false, () -> {
            Ui.Progress progress = new Ui.Progress(this, printer.displayName(), null);
            progress.update(getString(R.string.print_sending));
            PrintJobs.print(app, printer, template, PrintJobs.baseValues(app, printer, System.currentTimeMillis()), 1,
                    progress::update, new PrinterManager.Callback<Void>() {
                        @Override
                        public void onSuccess(Void value) {
                            progress.dismiss();
                            Toast.makeText(MainActivity.this, R.string.print_done, Toast.LENGTH_SHORT).show();
                            render();
                        }

                        @Override
                        public void onError(String message) {
                            progress.dismiss();
                            Ui.message(MainActivity.this, printer.displayName(), message);
                        }
                    });
        });
    }

    private void showPrinterMenu(View anchor, PrinterInfo printer) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add(0, 1, 0, R.string.printer_settings);
        menu.getMenu().add(0, 2, 1, R.string.printer_calibrate);
        menu.getMenu().add(0, 3, 2, R.string.printer_selftest);
        menu.getMenu().add(0, 4, 3, R.string.printer_remove);
        menu.setOnMenuItemClickListener(item -> {
            switch (item.getItemId()) {
                case 1:
                    editLabelSettings(printer);
                    return true;
                case 2:
                    confirmCommand(printer, getString(R.string.printer_calibrate),
                            getString(R.string.printer_calibrate_text), Tspl.calibrate(printer.label));
                    return true;
                case 3:
                    confirmCommand(printer, getString(R.string.printer_selftest),
                            getString(R.string.printer_selftest_text), Tspl.selfTest());
                    return true;
                case 4:
                    confirmRemove(printer);
                    return true;
                default:
                    return false;
            }
        });
        menu.show();
    }

    private void confirmCommand(PrinterInfo printer, String title, String text, byte[] command) {
        new MaterialAlertDialogBuilder(this)
                .setTitle(title)
                .setMessage(text)
                .setPositiveButton(R.string.continue_action, (d, w) -> withBluetooth(false, () -> {
                    Ui.Progress progress = new Ui.Progress(this, printer.displayName(), null);
                    progress.update(getString(R.string.print_sending));
                    PrintJobs.command(app, printer, command, progress::update, new PrinterManager.Callback<Void>() {
                        @Override
                        public void onSuccess(Void value) {
                            progress.dismiss();
                            Toast.makeText(MainActivity.this, R.string.print_command_done, Toast.LENGTH_SHORT).show();
                        }

                        @Override
                        public void onError(String message) {
                            progress.dismiss();
                            Ui.message(MainActivity.this, printer.displayName(), message);
                        }
                    });
                }))
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void confirmRemove(PrinterInfo printer) {
        new MaterialAlertDialogBuilder(this)
                .setTitle(getString(R.string.printer_remove_title, printer.displayName()))
                .setMessage(R.string.printer_remove_text)
                .setPositiveButton(R.string.printer_remove, (d, w) -> {
                    app.printerStore().remove(printer.address);
                    app.printers().forget(printer.address);
                    app.sync().enqueue(HelperEvents.printerRemoved(printer, System.currentTimeMillis()));
                    render();
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void editLabelSettings(PrinterInfo printer) {
        View view = getLayoutInflater().inflate(R.layout.dialog_label_settings, null);
        LabelSettings s = printer.label;
        EditText width = view.findViewById(R.id.settings_width);
        EditText height = view.findViewById(R.id.settings_height);
        EditText gap = view.findViewById(R.id.settings_gap);
        EditText density = view.findViewById(R.id.settings_density);
        EditText speed = view.findViewById(R.id.settings_speed);
        EditText shiftX = view.findViewById(R.id.settings_shift_x);
        EditText shiftY = view.findViewById(R.id.settings_shift_y);
        MaterialSwitch rotate = view.findViewById(R.id.settings_rotate);
        width.setText(String.valueOf(s.widthMm));
        height.setText(String.valueOf(s.heightMm));
        gap.setText(formatMm(s.gapMm));
        density.setText(String.valueOf(s.density));
        speed.setText(String.valueOf(s.speed));
        shiftX.setText(formatMm(s.shiftXmm));
        shiftY.setText(formatMm(s.shiftYmm));
        rotate.setChecked(s.rotate180);
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.settings_title)
                .setView(view)
                .setPositiveButton(R.string.save, (d, w) -> {
                    LabelSettings next = s.copy();
                    next.widthMm = parseInt(width, s.widthMm);
                    next.heightMm = parseInt(height, s.heightMm);
                    next.gapMm = parseFloat(gap, s.gapMm);
                    next.density = parseInt(density, s.density);
                    next.speed = parseInt(speed, s.speed);
                    next.shiftXmm = parseFloat(shiftX, s.shiftXmm);
                    next.shiftYmm = parseFloat(shiftY, s.shiftYmm);
                    next.rotate180 = rotate.isChecked();
                    printer.label = next.normalized();
                    app.printerStore().save(printer);
                    render();
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void showMenu(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add(0, 1, 0, R.string.main_menu_sync);
        if (BuildConfig.SELF_UPDATE) menu.getMenu().add(0, 3, 1, R.string.main_menu_updates);
        menu.getMenu().add(0, 2, 2, R.string.main_menu_logout);
        menu.getMenu().add(0, 4, 3, getString(R.string.main_menu_version, BuildConfig.VERSION_NAME)).setEnabled(false);
        menu.setOnMenuItemClickListener(item -> {
            if (item.getItemId() == 1) {
                app.sync().requestSync();
                renderStatus();
                return true;
            }
            if (item.getItemId() == 3) {
                app.updater().checkAsync(true, this::showCheckResult);
                return true;
            }
            if (item.getItemId() == 2) {
                confirmLogout();
                return true;
            }
            return false;
        });
        menu.show();
    }

    private void confirmLogout() {
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.main_logout_title)
                .setMessage(R.string.main_logout_text)
                .setPositiveButton(R.string.main_menu_logout, (d, w) -> logout())
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void logout() {
        SessionStore.Session session = app.sessions().load();
        app.wipeLocalData();
        if (session != null) {
            // Отозвать ключ на сервере, если есть сеть; нет — его можно отключить на сайте.
            app.io().execute(() -> {
                try {
                    app.api().logout(session.server, session.token);
                } catch (IOException ignored) {
                    // без сети ключ останется до отключения на сайте
                }
            });
        }
        openLogin(null);
    }

    private void openLogin(String message) {
        Intent intent = new Intent(this, LoginActivity.class);
        if (message != null) intent.putExtra(LoginActivity.EXTRA_MESSAGE, message);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }

    static String formatMm(float value) {
        float rounded = Math.round(value * 10f) / 10f;
        if (rounded == (int) rounded) return String.valueOf((int) rounded);
        return String.format(Locale.ROOT, "%.1f", rounded);
    }

    private static int parseInt(EditText input, int fallback) {
        try {
            return Integer.parseInt(input.getText().toString().trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static float parseFloat(EditText input, float fallback) {
        try {
            return Float.parseFloat(input.getText().toString().trim().replace(',', '.'));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
