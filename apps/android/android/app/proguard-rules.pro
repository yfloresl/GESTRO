# Reglas R8 / ProGuard de release (Capacitor). Capacitor y sus plugins ya traen reglas de consumidor; aquí se refuerzan las que
# el puente JavaScript <-> Java necesita para no romperse al ofuscar (ingreso OIDC/PKCE con Custom Tabs y appUrlOpen incluidos).

# Para leer los errores de producción en Play Console (rastros ofuscados) se conservan líneas y archivo de origen.
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile

# Puente WebView: los métodos expuestos a JS no pueden renombrarse.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Capacitor: núcleo, plugins (anotación @CapacitorPlugin y métodos @PluginMethod) y actividad principal.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keepclassmembers class * { @com.getcapacitor.PluginMethod public <methods>; @com.getcapacitor.annotation.PermissionCallback <methods>; @com.getcapacitor.annotation.ActivityCallback <methods>; }
-keep class com.capacitorjs.plugins.** { *; }
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep class * extends com.getcapacitor.BridgeActivity { *; }
-dontwarn com.getcapacitor.**

# Cordova (compatibilidad que carga Capacitor).
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**

# Retorno del ingreso: Custom Tabs de androidx.browser y el esquema/enlace de retorno (intent-filter del manifiesto).
-keep class androidx.browser.** { *; }
