package ru.wesetup.helper;

import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.util.Log;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import ru.wesetup.helper.auth.SessionStore;
import ru.wesetup.helper.bt.PrinterManager;
import ru.wesetup.helper.bt.PrinterStore;
import ru.wesetup.helper.net.ApiClient;
import ru.wesetup.helper.net.Outbox;
import ru.wesetup.helper.net.SyncManager;
import ru.wesetup.helper.template.TemplateRepository;

/** Общие части приложения: вход, принтеры, очередь событий, шаблоны. */
public class HelperApp extends Application {

    private static final String TAG = "SetupHelper";

    private SessionStore sessions;
    private PrinterStore printerStore;
    private PrinterManager printers;
    private Outbox outbox;
    private SyncManager sync;
    private ApiClient api;
    private TemplateRepository templates;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

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

        // Появилась сеть — отправить, что накопилось без неё.
        ConnectivityManager connectivity = getSystemService(ConnectivityManager.class);
        if (connectivity != null) {
            try {
                connectivity.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
                    @Override
                    public void onAvailable(Network network) {
                        sync.requestSync();
                    }
                });
            } catch (RuntimeException e) {
                Log.w(TAG, "Не следим за сетью", e);
            }
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

    public ApiClient api() {
        return api;
    }

    public TemplateRepository templates() {
        return templates;
    }

    /** Фоновый поток для входа и выхода. */
    public ExecutorService io() {
        return io;
    }

    /** Выход или отключение на сайте: на телефоне не остаётся ничего от аккаунта. */
    public void wipeLocalData() {
        sessions.clear();
        outbox.clear();
        printerStore.clear();
        getSharedPreferences(PrintJobs.VALUES_PREFS, MODE_PRIVATE).edit().clear().apply();
    }
}
