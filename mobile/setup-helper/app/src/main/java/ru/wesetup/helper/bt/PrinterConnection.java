package ru.wesetup.helper.bt;

import java.io.IOException;

/** Открытый канал до принтера: классический Bluetooth (SPP) или BLE. */
public interface PrinterConnection {

    void write(byte[] data) throws IOException;

    /**
     * Байт состояния TSPL ({@code <ESC>!?}) или -1, если принтер не ответил
     * (не все прошивки отвечают; это не ошибка).
     */
    int readStatus(long timeoutMs);

    boolean isOpen();

    void close();
}
