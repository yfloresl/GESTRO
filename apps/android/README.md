# GESTRO — app Android (Capacitor)

Envoltorio nativo **solo Android** (sin PWA/TWA) de `apps/web`. `appId`: `com.kyros.gestro`. Capacitor 6 (compileSdk 34, minSdk 22, Java 17).
No participa del pipeline de turbo: el paquete no define `build`/`typecheck`/`test`.

## Qué carga (y por qué)
La app abre **https://gestro.kyros-tech.com** (`server.url` en `capacitor.config.ts`). Es lo más robusto aquí: la web usa `/api` en el mismo
origen (sin CORS ni URL de API absoluta), la UI se corrige sin reinstalar el APK y no hay dos builds que mantener. Sin red muestra `www/error.html`.
Para probar contra otra URL: `CAP_SERVER_URL=http://10.0.2.2:5183 pnpm --filter @gestro/android android:sync` (Vite del host; solo pruebas).

## Prerrequisitos
- JDK 17 (`JAVA_HOME`), Android SDK con `platforms;android-34` y `build-tools;34.0.0` (`ANDROID_HOME`; en Windows `%LOCALAPPDATA%\Android\Sdk`), Node >= 22, pnpm.
- `pnpm install` en la raíz. Gradle 8.2.1 se descarga solo la primera vez.

## Generar el APK debug (firmado con el keystore debug de Android)
```bash
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk" JAVA_HOME="C:\Program Files\Java\jdk-17"   # no se persiste
pnpm --filter @gestro/android android:build      # = cap sync + gradlew assembleDebug + copia
# salida: dist/android/gestro-debug.apk  (dist/ está en .gitignore; no se commitea el binario)
```
Solo Gradle: `cd apps/android/android && ./gradlew assembleDebug` -> `app/build/outputs/apk/debug/app-debug.apk`.
Es un APK **debug** (certificado `CN=Android Debug`), instalable en emulador/dispositivo; no sirve para Play Store (sin keystore de producción por ahora).

## Instalar en el emulador de Android Studio
1. Device Manager -> crear/arrancar un AVD (API 34 recomendado; imagen Google APIs, con Chrome para Custom Tabs).
2. `"$ANDROID_HOME/platform-tools/adb" install -r dist/android/gestro-debug.apk`
3. Abrir «GESTRO» en el lanzador, o `adb shell am start -n com.kyros.gestro/.MainActivity`.
También se puede arrastrar el `.apk` sobre la ventana del emulador. Copia de entrega: `Adyton_Kyros/apk/gestro-debug.apk` (3,7 MB, `com.kyros.gestro`, minSdk 22).

## Flujo de login (Kyros ID, OIDC Authorization Code + PKCE S256)
1. En la web (dentro del WebView) «Ingresar»/«Crear cuenta» ejecuta el mismo `startKyrosIdFlow` de siempre (`apps/web/src/features/kyros-id/oidc.ts`).
2. En la app nativa el `client_id` es **`gestro-mobile`** (client público PKCE propio; la web sigue con el de la config pública), el `redirect_uri` (`native.ts` detecta `window.Capacitor`) es **`com.kyros.gestro://callback`** y la URL de autorización se abre en el **navegador del sistema (Custom Tabs, `@capacitor/browser`)**, nunca en el WebView (RFC 8252). El `state/nonce/verifier` temporal se guarda en `localStorage` (se borra al leer, caduca a 10 min) por si Android mata el proceso durante el login.
3. Kyros ID redirige a `com.kyros.gestro://callback?code=…&state=…`; el `intent-filter` del `AndroidManifest` abre la app (`singleTask`), `@capacitor/app` entrega `appUrlOpen`, se cierra la pestaña y el WebView va a `/callback` con **solo** `code`, `state` y `error`.
4. La API acepta el access token de `gestro-mobile` además del de la web (lista cerrada en `kyros-id.config.ts`; azp y aud exactos del client; cualquier otro client se rechaza). `CallbackPage` hace el canje PKCE contra el `tokenEndpoint` con el mismo `redirect_uri` y `client_id` nativos y valida `state`/`nonce`/`iss`/`aud`.
En el navegador normal nada cambia (`redirect_uri` = `https://…/callback`). Cobertura: `native.test.ts`.

## Kyros ID y despliegue
- El client público PKCE **`gestro-mobile`** ya existe en el realm `kyros` (redirect exacto `com.kyros.gestro://callback`, `azp = aud = gestro-mobile`). La API lo acepta en una **lista cerrada** (web + móvil); el SuperAdmin central nunca entra por la app.
- La app carga `https://gestro.kyros-tech.com`: debe estar desplegada la versión con el puente nativo (`apps/web/src/lib/nativo.ts`).
- Cierre de sesión: en la app cierra la sesión local; la sesión de Kyros ID vive en el navegador del sistema (cookie separada del WebView). Mejora futura: abrir `end_session` en Custom Tabs.
- Sin Play Store por ahora; el APK es debug (certificado `CN=Android Debug`).

## Notas de seguridad
`allowBackup=false`; solo el origen de la app navega dentro del WebView (`allowNavigation`); sin cleartext salvo `CAP_SERVER_URL` http de pruebas; sin secretos ni keystores de producción en el repo.
