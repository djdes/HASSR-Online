package ru.wesetup.helper;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.progressindicator.LinearProgressIndicator;
import com.google.android.material.textfield.TextInputLayout;

import java.io.IOException;

import ru.wesetup.helper.auth.SessionStore;
import ru.wesetup.helper.net.ApiClient;

/**
 * Вход с почтой и паролем WeSetup. Единственный экран, которому нужен
 * интернет; дальше приложение работает по сохранённому ключу.
 */
public final class LoginActivity extends AppCompatActivity {

    static final String EXTRA_MESSAGE = "message";

    private HelperApp app;
    private EditText email;
    private EditText password;
    private EditText code;
    private View credentials;
    private View codeGroup;
    private MaterialButton submit;
    private MaterialButton codeSubmit;
    private LinearProgressIndicator progress;
    private TextView error;
    private TextView server;
    private String challengeId;
    private boolean busy;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        app = HelperApp.get(this);
        setContentView(R.layout.activity_login);
        Ui.applySystemBarInsets(this, findViewById(R.id.login_root));

        email = findViewById(R.id.login_email);
        password = findViewById(R.id.login_password);
        code = findViewById(R.id.login_code);
        credentials = findViewById(R.id.login_credentials);
        codeGroup = findViewById(R.id.login_code_group);
        submit = findViewById(R.id.login_submit);
        codeSubmit = findViewById(R.id.login_code_submit);
        progress = findViewById(R.id.login_progress);
        error = findViewById(R.id.login_error);
        server = findViewById(R.id.login_server);

        submit.setOnClickListener(v -> login());
        codeSubmit.setOnClickListener(v -> confirm());
        findViewById(R.id.login_back).setOnClickListener(v -> showCredentials());
        password.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                login();
                return true;
            }
            return false;
        });
        code.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                confirm();
                return true;
            }
            return false;
        });
        server.setOnClickListener(v -> editServer());
        renderServer();

        String message = getIntent().getStringExtra(EXTRA_MESSAGE);
        if (message != null) showError(message);
    }

    private void login() {
        if (busy) return;
        String emailValue = email.getText().toString().trim();
        String passwordValue = password.getText().toString();
        if (emailValue.isEmpty() || passwordValue.isEmpty()) {
            showError(getString(R.string.login_fill));
            return;
        }
        String serverUrl = app.sessions().serverUrl();
        setBusy(true);
        app.io().execute(() -> {
            try {
                ApiClient.LoginResult result = app.api().login(serverUrl, emailValue, passwordValue, client());
                runOnUiThread(() -> handle(result, serverUrl, emailValue));
            } catch (IOException e) {
                runOnUiThread(() -> fail(e));
            }
        });
    }

    private void confirm() {
        if (busy || challengeId == null) return;
        String codeValue = code.getText().toString().trim();
        if (codeValue.isEmpty()) {
            showError(getString(R.string.login_fill_code));
            return;
        }
        String serverUrl = app.sessions().serverUrl();
        String emailValue = email.getText().toString().trim();
        String challenge = challengeId;
        setBusy(true);
        app.io().execute(() -> {
            try {
                ApiClient.LoginResult result = app.api().confirmCode(serverUrl, challenge, codeValue, client());
                runOnUiThread(() -> handle(result, serverUrl, emailValue));
            } catch (IOException e) {
                runOnUiThread(() -> fail(e));
            }
        });
    }

    private ApiClient.ClientInfo client() {
        return new ApiClient.ClientInfo(ApiClient.deviceName(), app.sessions().installationId());
    }

    private void handle(ApiClient.LoginResult result, String serverUrl, String emailValue) {
        if (isFinishing() || isDestroyed()) return;
        setBusy(false);
        if (result.requiresCode) {
            challengeId = result.challengeId;
            credentials.setVisibility(View.GONE);
            codeGroup.setVisibility(View.VISIBLE);
            error.setVisibility(View.GONE);
            code.requestFocus();
            return;
        }
        try {
            app.sessions().save(new SessionStore.Session(result.token, result.deviceId, result.userName,
                    result.email.isEmpty() ? emailValue : result.email, result.orgName, serverUrl,
                    System.currentTimeMillis()));
        } catch (Exception e) {
            showError("Не удалось сохранить вход на телефоне: " + e.getMessage());
            return;
        }
        // Пароль больше не нужен ни в памяти, ни на экране.
        password.setText("");
        app.sync().requestSync();
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }

    private void fail(IOException e) {
        if (isFinishing() || isDestroyed()) return;
        setBusy(false);
        showError(e.getMessage() == null ? "Не удалось войти" : e.getMessage());
    }

    private void showCredentials() {
        challengeId = null;
        code.setText("");
        codeGroup.setVisibility(View.GONE);
        credentials.setVisibility(View.VISIBLE);
        error.setVisibility(View.GONE);
    }

    private void setBusy(boolean value) {
        busy = value;
        progress.setVisibility(value ? View.VISIBLE : View.GONE);
        submit.setEnabled(!value);
        codeSubmit.setEnabled(!value);
        if (value) error.setVisibility(View.GONE);
    }

    private void showError(String message) {
        error.setText(message);
        error.setVisibility(View.VISIBLE);
    }

    private void renderServer() {
        String url = app.sessions().serverUrl();
        String host = Uri.parse(url).getHost();
        server.setText(getString(R.string.login_server, host == null ? url : host));
    }

    private void editServer() {
        View view = getLayoutInflater().inflate(R.layout.dialog_server, null);
        EditText input = view.findViewById(R.id.server_input);
        TextInputLayout layout = view.findViewById(R.id.server_layout);
        input.setText(app.sessions().serverUrl());
        AlertDialog dialog = new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.server_title)
                .setView(view)
                .setPositiveButton(R.string.save, null)
                .setNeutralButton(R.string.server_reset, (d, w) -> {
                    app.sessions().setServerUrl(BuildConfig.DEFAULT_SERVER);
                    renderServer();
                })
                .setNegativeButton(R.string.cancel, null)
                .create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String normalized = SessionStore.normalizeServer(input.getText().toString());
            if (normalized == null) {
                layout.setError(getString(R.string.server_invalid));
                return;
            }
            app.sessions().setServerUrl(normalized);
            renderServer();
            dialog.dismiss();
        }));
        dialog.show();
    }
}
