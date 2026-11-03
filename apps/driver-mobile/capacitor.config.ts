import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "br.com.avdelivery.entregador",
  appName: "AVDelivery Entregador",
  webDir: "dist",
  // The default ("debug") writes every plugin call payload, including the
  // Supabase session passed to SecureStorage, to logcat. Disable the bridge
  // log so debug builds used in internal testing never expose tokens.
  loggingBehavior: "none",
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
