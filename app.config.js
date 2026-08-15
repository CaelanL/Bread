export default {
  expo: {
    name: "Bread",
    slug: "biblemem",
    version: "1.2.0",
    // OTA updates (EAS Update). fingerprint policy: a hash of the native
    // project decides update compatibility, so JS-only merges ship OTA
    // and native changes force a store build. See
    // docs/features/release-automation.md.
    updates: {
      url: "https://u.expo.dev/7e758050-0746-4516-a231-dbea6ec702c6",
    },
    runtimeVersion: {
      policy: "fingerprint",
    },
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "com.biblemem",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.caelanliu.biblemem",
      buildNumber: "1",
      infoPlist: {
        NSMicrophoneUsageDescription: "Bread needs microphone access to record your verse recitations for accuracy scoring.",
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
    },
    web: {
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-font",
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
          dark: {
            backgroundColor: "#000000",
          },
        },
      ],
      [
        "expo-notifications",
        {
          // Default icon/color for Android (no-op on iOS).
          color: "#ffffff",
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    // Expose env vars to the app
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      eas: {
        projectId: "7e758050-0746-4516-a231-dbea6ec702c6",
      },
    },
  },
};
