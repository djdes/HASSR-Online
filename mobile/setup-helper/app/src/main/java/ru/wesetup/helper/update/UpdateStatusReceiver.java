package ru.wesetup.helper.update;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import ru.wesetup.helper.HelperApp;

/** Результат установки обновления от системы (сессия {@link SessionInstaller}). */
public final class UpdateStatusReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        HelperApp.get(context).updater().onInstallStatus(intent);
    }
}
