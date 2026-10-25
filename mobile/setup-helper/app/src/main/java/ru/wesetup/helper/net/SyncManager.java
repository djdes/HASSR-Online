package ru.wesetup.helper.net;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.io.IOException;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import ru.wesetup.helper.auth.SessionStore;

/**
 * Отправка очереди событий на сайт.
 *
 * <p>Запускается после каждого нового события, при открытии приложения и
 * когда появляется сеть. Без сети ничего не делает — события ждут в
 * {@link Outbox}. Ответ 401 значит, что телефон отключили на сайте: вход и
 * данные на телефоне стираются, приложение просит войти заново.
 */
public final class SyncManager {

    private static final String TAG = "SetupHelper";
    private static final int BATCH = 50;

    public interface Listener {
        /** Изменилось число неотправленных событий или состояние связи. */
        void onSyncStateChanged();

        void onSessionRevoked(String message);
    }

    /** Что стереть при отключении телефона на сайте. */
    public interface RevokeHandler {
        void wipeLocalData();
    }

    private final Context context;
    private final SessionStore sessions;
    private final Outbox outbox;
    private final ApiClient api;
    private final RevokeHandler revokeHandler;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
    private final AtomicBoolean queued = new AtomicBoolean(false);
    private volatile String lastError;

    public SyncManager(Context context, SessionStore sessions, Outbox outbox, ApiClient api,
                       RevokeHandler revokeHandler) {
        this.context = context.getApplicationContext();
        this.sessions = sessions;
        this.outbox = outbox;
        this.api = api;
        this.revokeHandler = revokeHandler;
    }

    public void addListener(Listener listener) {
        listeners.addIfAbsent(listener);
    }

    public void removeListener(Listener listener) {
        listeners.remove(listener);
    }

    public int pending() {
        return outbox.size();
    }

    public String lastError() {
        return lastError;
    }

    /** Записать событие в очередь и попробовать отправить. */
    public void enqueue(JSONObject event) {
        outbox.add(event);
        notifyChanged();
        requestSync();
    }

    public void requestSync() {
        if (!queued.compareAndSet(false, true)) return;
        executor.execute(() -> {
            queued.set(false);
            flush();
        });
    }

    private void flush() {
        SessionStore.Session session = sessions.load();
        if (session == null || outbox.size() == 0) return;
        if (!NetworkState.isOnline(context)) {
            notifyChanged();
            return;
        }
        // Не крутимся вечно: максимум несколько порций за раз.
        for (int round = 0; round < 10; round++) {
            List<JSONObject> batch = outbox.peek(BATCH);
            if (batch.isEmpty()) break;
            try {
                ApiClient.SyncResult result = api.sync(session.server, session.token, batch);
                Set<String> done = new HashSet<>(result.accepted);
                done.addAll(result.rejected);
                if (!result.rejected.isEmpty()) Log.w(TAG, "Сервер отклонил события: " + result.rejected);
                if (done.isEmpty()) break;
                outbox.remove(done);
                lastError = null;
            } catch (ApiClient.ApiException e) {
                if (e.status == 401) {
                    revoke(e.getMessage());
                    return;
                }
                lastError = e.getMessage();
                break;
            } catch (IOException e) {
                lastError = e.getMessage();
                break;
            }
        }
        notifyChanged();
    }

    private void revoke(String message) {
        Log.w(TAG, "Ключ отозван: " + message);
        revokeHandler.wipeLocalData();
        main.post(() -> {
            for (Listener listener : listeners) listener.onSessionRevoked(message);
        });
    }

    private void notifyChanged() {
        main.post(() -> {
            for (Listener listener : listeners) listener.onSyncStateChanged();
        });
    }
}
