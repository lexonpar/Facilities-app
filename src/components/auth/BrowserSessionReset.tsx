"use client";

import { useEffect } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { browserResetWasInitiatedHere, SESSION_RESET_CHANNEL, SESSION_RESET_STORAGE_KEY } from "@/lib/auth/browser-session";

/** Clear rendered identity and stop refresh in other open Facilities tabs. */
export function BrowserSessionReset() {
  useEffect(() => {
    let resetting = false;
    let channel: BroadcastChannel | undefined;
    const reset = () => {
      if (resetting || browserResetWasInitiatedHere()) return;
      resetting = true;
      if (isSupabaseConfigured()) {
        try {
          const client = createClient();
          void client.auth.stopAutoRefresh().catch(() => {});
          void client.removeAllChannels().catch(() => {});
        } catch { /* Navigation must still discard the previous page state. */ }
      }
      window.location.replace("/login?reason=shared-device");
    };
    const storage = (event: StorageEvent) => {
      if (event.key === SESSION_RESET_STORAGE_KEY && event.newValue) reset();
    };
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    try {
      channel = new BroadcastChannel(SESSION_RESET_CHANNEL);
      channel.onmessage = (event) => { if (event.data === "reset") reset(); };
    } catch { /* Storage events cover browsers without BroadcastChannel. */ }
    window.addEventListener("storage", storage);
    window.addEventListener("pageshow", pageshow);
    return () => {
      channel?.close();
      window.removeEventListener("storage", storage);
      window.removeEventListener("pageshow", pageshow);
    };
  }, []);
  return null;
}
