package ru.wesetup.helper.bt;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.util.Log;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.UUID;

import ru.wesetup.helper.print.Tspl;

/**
 * Классический Bluetooth, профиль последовательного порта (SPP) — так с
 * IP-802BT работают Android и Windows.
 *
 * <p>Три способа открыть канал, по очереди: защищённый сокет (нужно
 * сопряжение), незащищённый (многие принтеры пускают и без него) и прямой
 * канал 1 — для модулей, которые не объявляют SPP в списке служб.
 */
@SuppressLint("MissingPermission")
final class SppConnection implements PrinterConnection {

    private static final String TAG = "SetupHelper";
    static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    /** Принтеру нужно мгновение после подключения, иначе первые байты теряются. */
    private static final long SETTLE_MS = 250;
    private static final int CHUNK = 2048;
    private static final byte[] CRLF = {'\r', '\n'};

    private final BluetoothSocket socket;
    private final OutputStream out;
    private final InputStream in;

    private SppConnection(BluetoothSocket socket) throws IOException {
        this.socket = socket;
        this.out = socket.getOutputStream();
        this.in = socket.getInputStream();
    }

    static SppConnection open(BluetoothDevice device, boolean bonded) throws IOException {
        IOException last = null;
        // Без сопряжения защищённый сокет снова вызовет окно сопряжения — начинаем с незащищённого.
        for (int strategy = bonded ? 0 : 1; strategy < 3; strategy++) {
            BluetoothSocket socket = null;
            try {
                socket = createSocket(device, strategy);
                socket.connect();
                SppConnection connection = new SppConnection(socket);
                sleep(SETTLE_MS);
                return connection;
            } catch (IOException e) {
                Log.w(TAG, "SPP, способ " + strategy + ": " + e.getMessage());
                last = e;
                closeQuietly(socket);
                sleep(300);
            } catch (ReflectiveOperationException | RuntimeException e) {
                Log.w(TAG, "SPP, способ " + strategy + " недоступен: " + e);
                last = new IOException(e.getMessage(), e);
                closeQuietly(socket);
            }
        }
        throw last != null ? last : new IOException("Не удалось открыть канал печати");
    }

    private static BluetoothSocket createSocket(BluetoothDevice device, int strategy)
            throws IOException, ReflectiveOperationException {
        switch (strategy) {
            case 0:
                return device.createRfcommSocketToServiceRecord(SPP_UUID);
            case 1:
                return device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
            default:
                Method method = device.getClass().getMethod("createRfcommSocket", int.class);
                return (BluetoothSocket) method.invoke(device, 1);
        }
    }

    @Override
    public void write(byte[] data) throws IOException {
        for (int offset = 0; offset < data.length; offset += CHUNK) {
            out.write(data, offset, Math.min(CHUNK, data.length - offset));
        }
        out.flush();
    }

    @Override
    public int readStatus(long timeoutMs) {
        try {
            while (in.available() > 0) {
                if (in.read() < 0) return -1;
            }
            out.write(Tspl.STATUS_QUERY);
            // Прошивка без <ESC>!? иначе приклеит эти байты к следующей
            // команде («!?SIZE …») и потеряет её; пустая строка безвредна.
            out.write(CRLF);
            out.flush();
            long deadline = System.currentTimeMillis() + timeoutMs;
            while (System.currentTimeMillis() < deadline) {
                if (in.available() > 0) {
                    int value = in.read();
                    return value < 0 ? -1 : value & 0xFF;
                }
                sleep(20);
            }
        } catch (IOException e) {
            Log.w(TAG, "Состояние принтера не прочитано: " + e.getMessage());
        }
        return -1;
    }

    @Override
    public boolean isOpen() {
        return socket.isConnected();
    }

    @Override
    public void close() {
        closeQuietly(socket);
    }

    private static void closeQuietly(BluetoothSocket socket) {
        if (socket == null) return;
        try {
            socket.close();
        } catch (IOException ignored) {
            // уже закрыт
        }
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
