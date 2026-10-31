package ru.wesetup.helper;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import ru.wesetup.helper.auth.SessionStore;
import ru.wesetup.helper.catalog.CatalogStore;
import ru.wesetup.helper.bt.PrinterManager;
import ru.wesetup.helper.bt.PrinterStore;
import ru.wesetup.helper.net.ApiClient;
import ru.wesetup.helper.net.NetworkState;
import ru.wesetup.helper.net.Outbox;
import ru.wesetup.helper.net.SyncManager;
import ru.wesetup.helper.print.BrandingStore;
import ru.wesetup.helper.template.TemplateRepository;
import ru.wesetup.helper.update.SessionInstaller;
import ru.wesetup.helper.update.UpdateJobService;
import ru.wesetup.helper.update.UpdateSource;
import ru.wesetup.helper.update.UpdateStore;
import ru.wesetup.helper.update.Updater;

/** Общие части приложения: вход, принтеры, очередь событий, шаблоны, обновления. */
public class HelperApp extends Application {

    private static final String TAG = "SetupHelper";

    private SessionStore sessions;
    private PrinterStore printerStore;
    private PrinterManager printers;
    private Outbox outbox;
    private SyncManager sync;
    private ApiClient api;
    private BrandingStore branding;
    private CatalogStore catalog;
    private TemplateRepository templates;
    private Updater updater;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    /** Сколько экранов приложения сейчас видно: 0 — свёрнуто, можно ставить обновление. */
    private final AtomicInteger startedActivities = new AtomicInteger();

    public static HelperApp get(Context context) {
        return (HelperApp) context.getApplicationContext();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        sessions = createSessionStore();
        printerStore = new PrinterStore(this);
        printers = new PrinterManager(this);
        api = new ApiClient();
        branding = new BrandingStore(this);
        catalog = new CatalogStore(this);
        SharedPreferences outboxPrefs = getSharedPreferences("outbox", MODE_PRIVATE);
        outbox = new Outbox(new Outbox.Storage() {
            @Override
            public String read() {
                return outboxPrefs.getString("events", "[]");
            }

            @Override
            public void write(String value) {
                outboxPrefs.edit().putString("events", value).apply();
            }
        });
        sync = new SyncManager(this, sessions, outbox, api, this::wipeLocalData);
        templates = new TemplateRepository(this);
        updater = new Updater(this, new UpdateStore(this), createUpdateSource(), new SessionInstaller(this),
                new AppEnv());
        // Вариант для Google Play обновляет магазин: ни проверок, ни задания.
        if (BuildConfig.SELF_UPDATE) {
            updater.onAppStarted();
            trackVisibility();
            // Проверка обновлений в фоне раз в 6 часов, когда есть сеть.
            UpdateJobService.schedule(this);
        }

        // Появилась сеть — отправить, что накопилось без неё, и проверить обновление.
        ConnectivityManager connectivity = getSystemService(ConnectivityManager.class);
        if (connectivity != null) {
            try {
                connectivity.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
                    @Override
                    public void onAvailable(Network network) {
                        sync.requestSync();
                        refreshSiteData();
                        if (BuildConfig.SELF_UPDATE) updater.checkAsync(false, null);
                    }
                });
            } catch (RuntimeException e) {
                Log.w(TAG, "Не следим за сетью", e);
            }
        }
    }

    /** Тесты на Robolectric отключают: в сеть они не ходят. */
    protected boolean siteDataRefreshEnabled() {
        return true;
    }

    /**
     * Данные сайта для этикеток: шапка (логотип, сайт) и справочники
     * (продукты, блюда, поставщики, сотрудники) — скачать, если на сайте
     * новее. Без сети и без входа ничего не делает; ошибки молча пропускает -
     * печать работает с последней копией.
     */
    public void refreshSiteData() {
        if (!siteDataRefreshEnabled()) return;
        io.execute(() -> {
            SessionStore.Session session = sessions.load();
            if (session == null || !NetworkState.isOnline(this)) return;
            try {
                branding.refresh(api, session.server, session.token);
            } catch (java.io.IOException e) {
                // 401 разберёт sync (выход из аккаунта), остальное - повторим при следующей связи.
                Log.w(TAG, "Оформление этикеток не обновлено: " + e.getMessage());
            }
            try {
                catalog.refresh(api, session.server, session.token);
            } catch (java.io.IOException e) {
                Log.w(TAG, "Справочник не обновлён: " + e.getMessage());
            }
        });
    }

    /** Откуда брать обновления: сайт. Тесты на Robolectric подменяют — в сеть они не ходят. */
    protected UpdateSource createUpdateSource() {
        return api;
    }

    private void trackVisibility() {
        registerActivityLifecycleCallbacks(new ActivityLifecycleCallbacks() {
            @Override
            public void onActivityStarted(Activity activity) {
                if (startedActivities.incrementAndGet() == 1) updater.onAppForegrounded();
            }

            @Override
            public void onActivityStopped(Activity activity) {
                // Свернули — обновление можно ставить, никого не прервав.
                if (startedActivities.decrementAndGet() == 0) updater.onAppBackgrounded();
            }

            @Override
            public void onActivityCreated(Activity activity, Bundle savedInstanceState) {
            }

            @Override
            public void onActivityResumed(Activity activity) {
            }

            @Override
            public void onActivityPaused(Activity activity) {
            }

            @Override
            public void onActivitySaveInstanceState(Activity activity, Bundle outState) {
            }

            @Override
            public void onActivityDestroyed(Activity activity) {
            }
        });
    }

    /** Что автообновлению нужно знать о телефоне. */
    private final class AppEnv implements Updater.Env {
        @Override
        public boolean online() {
            return NetworkState.isOnline(HelperApp.this);
        }

        @Override
        public boolean appVisible() {
            return startedActivities.get() > 0;
        }

        @Override
        public boolean printerBusy() {
            return printers.isBusy();
        }

        @Override
        public String server() {
            SessionStore.Session session = sessions.load();
            return session != null ? session.server : sessions.serverUrl();
        }

        @Override
        public long now() {
            return System.currentTimeMillis();
        }

        @Override
        public int installedVersionCode() {
            return BuildConfig.VERSION_CODE;
        }

        @Override
        public int sdk() {
            return Build.VERSION.SDK_INT;
        }

        @Override
        public boolean canInstallPackages() {
            return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls();
        }
    }

    /** Тесты на Robolectric подменяют шифрование: Android Keystore там нет. */
    protected SessionStore createSessionStore() {
        return new SessionStore(this);
    }

    public SessionStore sessions() {
        return sessions;
    }

    public PrinterStore printerStore() {
        return printerStore;
    }

    public PrinterManager printers() {
        return printers;
    }

    public SyncManager sync() {
        return sync;
    }

    public BrandingStore branding() {
        return branding;
    }

    public CatalogStore catalog() {
        return catalog;
    }

    public ApiClient api() {
        return api;
    }

    public TemplateRepository templates() {
        return templates;
    }

    public Updater updater() {
        return updater;
    }

    /** Фоновый поток для входа и выхода. */
    public ExecutorService io() {
        return io;
    }

    /** Выход или отключение на сайте: на телефоне не остаётся ничего от аккаунта. */
    public void wipeLocalData() {
        sessions.clear();
        branding.clear();
        catalog.clear();
        outbox.clear();
        printerStore.clear();
        getSharedPreferences(PrintJobs.VALUES_PREFS, MODE_PRIVATE).edit().clear().apply();
        // История печати — тексты этикеток этого заведения: при выходе не оставляем.
        getSharedPreferences(PrintHistory.PREFS, MODE_PRIVATE).edit().clear().apply();
    }
}
