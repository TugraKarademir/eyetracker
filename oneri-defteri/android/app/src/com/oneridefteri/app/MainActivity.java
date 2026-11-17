package com.oneridefteri.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final int REQ_EXPORT = 1;
    private static final int REQ_IMPORT = 2;
    private static final String START_URL = "file:///android_asset/index.html";

    private WebView web;
    private String pendingExport;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowContentAccess(false);
        s.setAllowFileAccess(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (u.toString().startsWith("file:///android_asset/")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.appBack ? window.appBack() : false", new ValueCallback<String>() {
            @Override public void onReceiveValue(String value) {
                if (!"true".equals(value)) finish();
            }
        });
    }

    private void js(final String code) {
        runOnUiThread(new Runnable() {
            @Override public void run() { web.evaluateJavascript(code, null); }
        });
    }

    private class Bridge {
        @JavascriptInterface
        public void exportJson(final String json, final String fileName) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    pendingExport = json;
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("application/json");
                    i.putExtra(Intent.EXTRA_TITLE, fileName);
                    try { startActivityForResult(i, REQ_EXPORT); }
                    catch (Exception e) { js("window.onExportDone(false)"); }
                }
            });
        }

        @JavascriptInterface
        public void importJson() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
                    try { startActivityForResult(i, REQ_IMPORT); }
                    catch (Exception e) { js("window.onImport('')"); }
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        Uri uri = (resultCode == RESULT_OK && data != null) ? data.getData() : null;

        if (requestCode == REQ_EXPORT) {
            String json = pendingExport;
            pendingExport = null;
            if (uri == null || json == null) return;
            try (OutputStream os = getContentResolver().openOutputStream(uri, "wt")) {
                os.write(json.getBytes(StandardCharsets.UTF_8));
                js("window.onExportDone(true)");
            } catch (Exception e) {
                js("window.onExportDone(false)");
            }
        } else if (requestCode == REQ_IMPORT) {
            if (uri == null) return;
            try (InputStream is = getContentResolver().openInputStream(uri)) {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] b = new byte[8192];
                int n;
                while ((n = is.read(b)) > 0) buf.write(b, 0, n);
                String text = new String(buf.toByteArray(), StandardCharsets.UTF_8);
                js("window.onImport(" + JSONObject.quote(text) + ")");
            } catch (Exception e) {
                js("window.onImport('')");
            }
        }
    }
}
