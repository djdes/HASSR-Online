package ru.wesetup.helper.bt;

import android.bluetooth.BluetoothAdapter;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.io.IOException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import ru.wesetup.helper.print.Tspl;

/**
 * Единственная точка работы с принтерами. Все операции Bluetooth идут по
 * очереди в одном фоновом потоке; соединение держится полторы минуты после
 * последней печати, чтобы следующая этикетка не ждала подключения.
 */
public final class PrinterManager {

    private static final String TAG = "SetupHelper";
    private static final long IDLE_CLOSE_MS = 90_000;
    private static final long STATUS_TIMEOUT_MS = 500;

    public interface Callback<T> {
        void onSuccess(T value);

        void onError(String message);
    }

    /** Сборка задания — в фоновом потоке (рисование этикетки тоже не для главного). */
    public interface JobBuilder {
        byte[] build() throws Exception;
    }

    /** Ошибка, которую стоит показать человеку как есть. */
    static final class PrinterProblem extends IOException {
        PrinterProblem(String message) {
            super(message);
        }
    }

    private final Context context;
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private PrinterConnection active;
    private String activeAddress;
    private ScheduledFuture<?> idleClose;

    public PrinterManager(Context context) {
        this.context = context.getApplicationContext();
    }

    /** Подключить новый принтер с экрана поиска. */
    public void connectNew(FoundDevice device, PrinterConnector.Progress progress, Callback<PrinterInfo> callback) {
        worker.execute(() -> {
            try {
                closeActive();
                BluetoothAdapter adapter = requireAdapter();
                String preferred = device.le && !device.classic ? PrinterInfo.TRANSPORT_BLE : PrinterInfo.TRANSPORT_CLASSIC;
                PrinterConnector.Result result = PrinterConnector.connect(context, adapter, device.address, preferred,
                        null, null, onMain(progress));
                PrinterInfo info = new PrinterInfo(device.address);
                info.name = device.hasName() ? device.name : null;
                info.model = PrinterNames.modelFor(device.name);
                info.transport = result.transport;
                info.bleService = result.bleService;
                info.bleCharacteristic = result.bleCharacteristic;
                info.addedAt = System.currentTimeMillis();
                keep(device.address, result.connection);
                post(() -> callback.onSuccess(info));
            } catch (Exception e) {
                Log.w(TAG, "Принтер не подключён", e);
                closeActive();
                String message = explain(e);
                post(() -> callback.onError(message));
            }
        });
    }

    /** Отправить задание на принтер; подключится сам, если нужно. */
    public void send(PrinterInfo printer, JobBuilder builder, PrinterConnector.Progress progress, Callback<Void> callback) {
        worker.execute(() -> {
            try {
                byte[] job = builder.build();
                PrinterConnection connection = ensureConnected(printer, onMain(progress));
                String problem = Tspl.statusProblem(connection.readStatus(STATUS_TIMEOUT_MS));
                if (problem != null) throw new PrinterProblem(problem);
                post(() -> progress.onStatus("Печатаем…"));
                try {
                    connection.write(job);
                } catch (IOException stale) {
                    // Соединение могло уснуть, пока принтер лежал без дела, — одна попытка заново.
                    Log.w(TAG, "Повторное подключение перед печатью", stale);
                    closeActive();
                    ensureConnected(printer, onMain(progress)).write(job);
                }
                scheduleIdleClose();
                post(() -> callback.onSuccess(null));
            } catch (Exception e) {
                Log.w(TAG, "Печать не удалась", e);
                if (!(e instanceof PrinterProblem)) closeActive();
                String message = explain(e);
                post(() -> callback.onError(message));
            }
        });
    }

    /** Закрыть соединение, если принтер удалили. */
    public void forget(String address) {
        worker.execute(() -> {
            if (address.equals(activeAddress)) closeActive();
        });
    }

    private PrinterConnection ensureConnected(PrinterInfo printer, PrinterConnector.Progress progress) throws IOException {
        if (active != null && active.isOpen() && printer.address.equals(activeAddress)) return active;
        closeActive();
        progress.onStatus("Подключаемся к принтеру…");
        PrinterConnector.Result result = PrinterConnector.connect(context, requireAdapter(), printer.address,
                printer.transport, printer.bleService, printer.bleCharacteristic, progress);
        keep(printer.address, result.connection);
        return result.connection;
    }

    private BluetoothAdapter requireAdapter() throws IOException {
        BluetoothAdapter adapter = BtSupport.adapter(context);
        if (adapter == null) throw new PrinterProblem("На этом телефоне нет Bluetooth");
        if (!adapter.isEnabled()) throw new PrinterProblem("Включите Bluetooth");
        return adapter;
    }

    private void keep(String address, PrinterConnection connection) {
        active = connection;
        activeAddress = address;
        scheduleIdleClose();
    }

    private void scheduleIdleClose() {
        if (idleClose != null) idleClose.cancel(false);
        idleClose = worker.schedule(this::closeActive, IDLE_CLOSE_MS, TimeUnit.MILLISECONDS);
    }

    private void closeActive() {
        if (idleClose != null) {
            idleClose.cancel(false);
            idleClose = null;
        }
        if (active != null) active.close();
        active = null;
        activeAddress = null;
    }

    private PrinterConnector.Progress onMain(PrinterConnector.Progress progress) {
        return message -> post(() -> progress.onStatus(message));
    }

    private void post(Runnable runnable) {
        main.post(runnable);
    }

    /** Понятная причина вместо «read failed, socket might closed or timeout». */
    static String explain(Exception e) {
        if (e instanceof PrinterProblem) return e.getMessage();
        if (e instanceof SecurityException) return "Нет доступа к Bluetooth — разрешите его в настройках приложения";
        String detail = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        return "Принтер не ответил. Проверьте, что он включён, стоит рядом и не подключён к другому телефону. ("
                + detail + ")";
    }
}
