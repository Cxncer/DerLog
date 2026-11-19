package com.derlog.app;

import android.accounts.Account;
import android.os.Bundle;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.UserRecoverableAuthException;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

/**
 * Google sign-in for the DerLog Android shell.
 *
 * The WebView build cannot use Google Identity Services (Google blocks sign-in inside
 * embedded web views), so the account picker is shown natively by Google Play services
 * and this plugin hands the web layer a normal OAuth access token. The token is minted
 * for the Drive app-folder scope, which is what the cloud backup uses.
 */
@CapacitorPlugin(name = "GoogleAuth")
public class GoogleAuthPlugin extends Plugin {

    private static final String DRIVE_APP_DATA = "https://www.googleapis.com/auth/drive.appdata";
    private static final String USERINFO_SCOPES =
        "https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email";
    private static final int SIGN_IN_CANCELLED = 12501;
    private static final int TOKEN_TTL_SECONDS = 3300;

    @PluginMethod
    public void signIn(final PluginCall call) {
        final String clientId = call.getString("clientId");
        if (clientId == null || clientId.isEmpty()) {
            call.reject("NO_CLIENT_ID");
            return;
        }

        GoogleSignInOptions options = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(clientId)
            .requestEmail()
            .requestScopes(new Scope(DRIVE_APP_DATA))
            .build();
        final GoogleSignInClient client = GoogleSignIn.getClient(getContext(), options);

        // Clearing the cached account first makes Google show the account picker, so a
        // traveler signed into another account on the phone can still choose theirs.
        client.signOut().addOnCompleteListener(task ->
            startActivityForResult(call, client.getSignInIntent(), "signInResult")
        );
    }

    @ActivityCallback
    private void signInResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        try {
            GoogleSignInAccount account = GoogleSignIn
                .getSignedInAccountFromIntent(result.getData())
                .getResult(ApiException.class);
            if (account == null) {
                call.reject("SIGN_IN_FAILED:empty");
                return;
            }
            fetchAccessToken(call, account);
        } catch (ApiException e) {
            if (e.getStatusCode() == SIGN_IN_CANCELLED) {
                call.reject("CANCELLED");
            } else {
                call.reject("SIGN_IN_FAILED:" + e.getStatusCode());
            }
        }
    }

    @ActivityCallback
    private void recoverResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getContext());
        if (account == null) {
            call.reject("SIGN_IN_FAILED:empty");
            return;
        }
        fetchAccessToken(call, account);
    }

    private void fetchAccessToken(final PluginCall call, final GoogleSignInAccount account) {
        new Thread(() -> {
            try {
                Bundle params = new Bundle();
                params.putBoolean("suppressProgressScreen", true);
                String token = GoogleAuthUtil.getToken(
                    getContext(),
                    account.getAccount(),
                    "oauth2:" + DRIVE_APP_DATA + " " + USERINFO_SCOPES,
                    params
                );

                JSObject payload = new JSObject();
                payload.put("accessToken", token);
                payload.put("expiresIn", TOKEN_TTL_SECONDS);
                payload.put("idToken", account.getIdToken());
                payload.put("name", account.getDisplayName());
                payload.put("email", account.getEmail());
                payload.put("givenName", account.getGivenName());
                payload.put("familyName", account.getFamilyName());
                payload.put("imageUrl", account.getPhotoUrl() == null ? "" : account.getPhotoUrl().toString());
                call.resolve(payload);
            } catch (UserRecoverableAuthException recoverable) {
                getActivity().runOnUiThread(() ->
                    startActivityForResult(call, recoverable.getIntent(), "recoverResult")
                );
            } catch (Exception e) {
                Log.e("DerLogGoogle", "Could not read Google access token", e);
                call.reject("TOKEN_FAILED:" + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void signOut(final PluginCall call) {
        GoogleSignInOptions options = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN).build();
        GoogleSignIn.getClient(getContext(), options)
            .signOut()
            .addOnCompleteListener(task -> call.resolve());
    }
}
