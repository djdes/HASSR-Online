package ru.wesetup.helper.update;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.util.Log;

import ru.wesetup.helper.HelperApp;

/**
 * Фоновая проверка обновлений раз в 6 часов — даже если приложение не
 * открывают. Условие «есть сеть» ставит JobScheduler: без интернета задание
 * просто ждёт, а после перезагрузки телефона восстанавливается само.
 */
public final class UpdateJobService extends JobService {

    private static final String TAG = "SetupHelper";
    static final int JOB_ID = 2001;
    static final long PERIOD_MS = 6 * 60 * 60_000L;
    static final long FLEX_MS = 60 * 60_000L;

    /** Поставить задание, если его ещё нет (повторный вызов ничего не меняет). */
    public static void schedule(Context context) {
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler == null) return;
        JobInfo pending = scheduler.getPendingJob(JOB_ID);
        if (pending != null && pending.getIntervalMillis() == PERIOD_MS && pending.isPersisted()) return;
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, UpdateJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(PERIOD_MS, FLEX_MS)
                .setPersisted(true)
                .build();
        try {
            scheduler.schedule(job);
        } catch (RuntimeException e) {
            Log.w(TAG, "Проверка обновлений в фоне не поставлена", e);
        }
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        HelperApp.get(this).updater().runJob(() -> jobFinished(params, false));
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        // Система прервала (пропала сеть) — пусть повторит.
        return true;
    }
}
