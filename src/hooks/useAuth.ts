"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { Profile } from "@/lib/types/profile";

type AuthUser = { id: string; email: string };

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    const supabase = createClient();
    await supabase.auth.getSession();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser?.email) {
      setUser(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    setUser({ id: authUser.id, email: authUser.email });

    try {
      const res = await fetch("/api/auth/profile", { cache: "no-store" });
      const data = (await res.json()) as { profile?: Profile | null };
      setProfile(data.profile ?? null);
    } catch {
      setProfile(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadProfile();
    }, 0);

    if (!isSupabaseConfigured()) {
      return () => window.clearTimeout(timeoutId);
    }

    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void loadProfile();
    });

    return () => {
      window.clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  return { user, profile, loading, refresh: loadProfile };
}
