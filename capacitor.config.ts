import { CapacitorConfig } from '@capacitor/cli';

// TMC_PATCH67 — Capacitor config for TapMyCar+
// appId matches the Bundle ID registered in Apple Developer Portal.
// webDir = public, where our static site lives.

const config: CapacitorConfig = {
  appId: 'io.tapmycar.app',
  appName: 'TapMyCar+',
  webDir: 'public',
  server: {
    // TMC_PATCH104_LIVE_RELOAD_TESTING_MODE
    // TEMPORARY: loads the live tapmycar.io website instead of bundled files,
    // so CSS/HTML/JS fixes show up on refresh without a full rebuild.
    // MUST REMOVE the "url" line below before the final App Store submission build.
    url: 'https://tapmycar.io',
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
  android: {
    backgroundColor: "#FF6B00" // TMC_PATCH91
  },
  plugins: {
    CapacitorHttp: {
      // TMC_PATCH76 — bypasses CORS by using native HTTP
      // (Java OkHttp on Android, URLSession on iOS).
      // Browser CORS rules don't apply to native requests.
      enabled: true
    },
    SplashScreen: {
      // TMC_PATCH88: hide system splash immediately
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: "#FF6B00",
      showSpinner: false,
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      splashFullScreen: true,
      splashImmersive: true
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
