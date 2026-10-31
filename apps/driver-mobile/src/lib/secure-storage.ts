import { SecureStorage } from "@aparajita/capacitor-secure-storage";

/**
 * Adapter expected by supabase-js. The Android implementation keeps the
 * session encrypted with a key from the Android Keystore; the web fallback is
 * only used for local development.
 */
export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return await SecureStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    await SecureStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    try {
      await SecureStorage.removeItem(key);
    } catch {
      // Removing a missing key is not an error for the session lifecycle.
    }
  },
};
