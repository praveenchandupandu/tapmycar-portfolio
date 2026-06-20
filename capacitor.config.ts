import { CapacitorConfig } from '@capacitor/cli';

// TMC_PATCH67 — Capacitor config for TapMyCar+
// appId matches the Bundle ID registered in Apple Developer Portal.
// webDir = public, where our static site lives.

const config: CapacitorConfig = {
  appId: 'io.tapmycar.app',
  appName: 'TapMyCar+',
  webDir: 'public',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    // External domains allowed for navigation/fetch from inside the app
    allowNavigation: [
      'tapmycar.io',
      '*.tapmycar.io',
      'api.stripe.com',
      'js.stripe.com',
      'checkout.stripe.com'
    ]
  },
  plugins: {
    CapacitorHttp: {
      // TMC_PATCH76 — bypasses CORS by using native HTTP
      // (Java OkHttp on Android, URLSession on iOS).
      // Browser CORS rules don't apply to native requests.
      enabled: true
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    Browser: {
      // External browser for purchase flows (opens Safari on iOS, Chrome on Android)
    }
  }
};

export default config;
