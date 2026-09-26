package ru.wesetup.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.Logger;
import java.io.File;
import java.io.IOException;
import java.util.Locale;

/**
 * Выбор фото для {@code <input type="file" accept="image/*">} без {@code capture}.
 *
 * Стандартный клиент Capacitor в этом случае открывает только галерею/файлы, а
 * сотруднику на кухне нужно и сфотографировать, и выбрать готовый снимок. Здесь
 * показываем системный выбор «Камера / Галерея / Файлы». Поля с
 * {@code capture="environment"} (сразу камера), выбор документов (Excel, CSV),
 * камера для сканера (getUserMedia) и микрофон остаются за стандартным клиентом.
 */
public class WeSetupWebChromeClient extends BridgeWebChromeClient {

    private static final String TAG = "WeSetupFileChooser";

    private final Bridge bridge;
    private final ActivityResultLauncher<String> cameraPermissionLauncher;
    private final ActivityResultLauncher<Intent> chooserLauncher;

    private ValueCallback<Uri[]> pendingCallback;
    private FileChooserParams pendingParams;
    private File pendingPhotoFile;
    private Uri pendingPhotoUri;

    public WeSetupWebChromeClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
        cameraPermissionLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.RequestPermission(),
            (granted) -> openChooser(Boolean.TRUE.equals(granted))
        );
        chooserLauncher = bridge.registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), this::onChooserResult);
    }

    @Override
    public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
        if (fileChooserParams.isCaptureEnabled() || !acceptsOnlyImages(fileChooserParams.getAcceptTypes())) {
            return super.onShowFileChooser(webView, filePathCallback, fileChooserParams);
        }
        if (pendingCallback != null) {
            pendingCallback.onReceiveValue(null);
        }
        pendingCallback = filePathCallback;
        pendingParams = fileChooserParams;
        if (ContextCompat.checkSelfPermission(bridge.getContext(), Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            openChooser(true);
        } else {
            // При отказе в камере остаётся галерея — поле всё равно работает.
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA);
        }
        return true;
    }

    /** Только картинки: accept="image/*", "image/png,image/jpeg", ".jpg" и т.п. */
    static boolean acceptsOnlyImages(String[] acceptTypes) {
        if (acceptTypes == null) {
            return false;
        }
        boolean hasAny = false;
        for (String raw : acceptTypes) {
            if (raw == null) continue;
            for (String part : raw.split(",")) {
                String type = part.trim().toLowerCase(Locale.ROOT);
                if (type.isEmpty()) continue;
                hasAny = true;
                boolean image =
                    type.startsWith("image/") ||
                    type.equals(".jpg") ||
                    type.equals(".jpeg") ||
                    type.equals(".png") ||
                    type.equals(".heic") ||
                    type.equals(".webp");
                if (!image) {
                    return false;
                }
            }
        }
        return hasAny;
    }

    private void openChooser(boolean withCamera) {
        if (pendingCallback == null || pendingParams == null) {
            return;
        }
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        pick.setType("image/*");
        if (pendingParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
            pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }

        Intent chooser = Intent.createChooser(pick, "Фото");
        if (withCamera) {
            try {
                pendingPhotoUri = createPhotoUri();
                Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                camera.putExtra(MediaStore.EXTRA_OUTPUT, pendingPhotoUri);
                camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] { camera });
            } catch (IOException | IllegalArgumentException ex) {
                Logger.warn(TAG, "Камера недоступна: " + ex.getMessage());
                pendingPhotoFile = null;
                pendingPhotoUri = null;
            }
        }
        try {
            chooserLauncher.launch(chooser);
        } catch (ActivityNotFoundException ex) {
            finish(null);
        }
    }

    private void onChooserResult(ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK) {
            finish(null);
            return;
        }
        Intent data = result.getData();
        if (data != null && data.getClipData() != null) {
            int count = data.getClipData().getItemCount();
            Uri[] uris = new Uri[count];
            for (int i = 0; i < count; i++) {
                uris[i] = data.getClipData().getItemAt(i).getUri();
            }
            finish(uris);
        } else if (data != null && data.getData() != null) {
            finish(new Uri[] { data.getData() });
        } else if (pendingPhotoUri != null && pendingPhotoFile != null && pendingPhotoFile.length() > 0) {
            // Камера ничего не кладёт в Intent — снимок уже записан в наш файл.
            finish(new Uri[] { pendingPhotoUri });
        } else {
            finish(null);
        }
    }

    private Uri createPhotoUri() throws IOException {
        Activity activity = bridge.getActivity();
        File dir = activity.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (dir == null) {
            dir = activity.getCacheDir();
        }
        pendingPhotoFile = File.createTempFile("wesetup_", ".jpg", dir);
        return FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", pendingPhotoFile);
    }

    private void finish(Uri[] result) {
        if (pendingCallback != null) {
            pendingCallback.onReceiveValue(result);
        }
        if (pendingPhotoFile != null && pendingPhotoFile.length() == 0) {
            // Выбрали из галереи — пустой файл под снимок больше не нужен.
            //noinspection ResultOfMethodCallIgnored
            pendingPhotoFile.delete();
        }
        pendingCallback = null;
        pendingParams = null;
        pendingPhotoUri = null;
        pendingPhotoFile = null;
    }
}
