import type { CapacitorConfig } from '@capacitor/cli';

// La app carga la web de producción (server.url): el APK es un envoltorio y la UI se actualiza sin reinstalar.
// `CAP_SERVER_URL` solo para pruebas locales al hacer `cap sync` (p. ej. http://10.0.2.2:5183 hacia el Vite del host); nunca se persiste.
const serverUrl = process.env.CAP_SERVER_URL ?? 'https://gestro.kyros-tech.com';
const insecure = serverUrl.startsWith('http://');

const config: CapacitorConfig = {
  appId: 'com.kyros.gestro',
  appName: 'GESTRO',
  webDir: 'www',
  server: {
    url: serverUrl,
    cleartext: insecure,
    errorPath: 'error.html',
    // Navegación permitida dentro del WebView: solo el origen de la app. Kyros ID se abre SIEMPRE en el navegador del sistema.
    allowNavigation: [new URL(serverUrl).host],
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
