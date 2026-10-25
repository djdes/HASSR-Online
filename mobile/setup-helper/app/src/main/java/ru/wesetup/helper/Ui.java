package ru.wesetup.helper;

import android.app.Activity;
import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Мелочи интерфейса, общие для экранов. */
final class Ui {

    private Ui() {
    }

    /**
     * С targetSdk 35+ Android рисует приложение под строкой состояния и
     * навигацией. Корню экрана добавляем отступы по системным панелям и
     * клавиатуре, чтобы ничего не пряталось.
     */
    static void applySystemBarInsets(Activity activity, View root) {
        WindowCompat.setDecorFitsSystemWindows(activity.getWindow(), false);
        int left = root.getPaddingLeft();
        int top = root.getPaddingTop();
        int right = root.getPaddingRight();
        int bottom = root.getPaddingBottom();
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
            view.setPadding(left + bars.left, top + bars.top, right + bars.right, bottom + bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(activity.getWindow(), root);
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);
    }

    static String dateTime(long millis) {
        return new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.forLanguageTag("ru")).format(new Date(millis));
    }

    static String date(long millis) {
        return new SimpleDateFormat("dd.MM.yyyy", Locale.forLanguageTag("ru")).format(new Date(millis));
    }

    /** Окно «идёт работа» с меняющимся текстом: подключение, печать. */
    static final class Progress {
        private final AlertDialog dialog;
        private final TextView message;

        Progress(Activity activity, String title, String note) {
            View view = LayoutInflater.from(activity).inflate(R.layout.dialog_progress, null);
            message = view.findViewById(R.id.progress_message);
            TextView noteView = view.findViewById(R.id.progress_note);
            if (note == null) {
                noteView.setVisibility(View.GONE);
            } else {
                noteView.setText(note);
            }
            dialog = new MaterialAlertDialogBuilder(activity)
                    .setTitle(title)
                    .setView(view)
                    .setCancelable(false)
                    .create();
            dialog.show();
        }

        void update(String text) {
            message.setText(text);
        }

        void dismiss() {
            if (dialog.isShowing()) {
                try {
                    dialog.dismiss();
                } catch (IllegalArgumentException ignored) {
                    // экран уже закрыт
                }
            }
        }
    }

    static void message(Context context, String title, String text) {
        new MaterialAlertDialogBuilder(context)
                .setTitle(title)
                .setMessage(text)
                .setPositiveButton(R.string.ok, null)
                .show();
    }
}
