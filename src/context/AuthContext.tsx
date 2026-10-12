import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { uploadAvatar } from '../services/avatarService';
import { Profile } from '../types';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    accountType?: Profile['account_type'],
    avatarUri?: string | null
  ) => Promise<{ error: Error | null; requiresEmailConfirmation?: boolean }>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signInWithFacebook: () => Promise<{ error: Error | null }>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updateProfile: (data: Partial<Profile>) => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching profile:', error);
      }
      setProfile(data || null);
    } catch (error) {
      console.error('Error fetching profile:', error);
      setProfile(null);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  }, [user, fetchProfile]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      }
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          await fetchProfile(session.user.id);
        } else {
          setProfile(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signInWithProvider = async (provider: 'google' | 'facebook') => {
    try {
      const redirectUrl = Linking.createURL('auth/callback');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });
      if (error) return { error };
      if (!data.url) return { error: new Error('Could not start sign-in. Please try again.') };

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
      if (result.type !== 'success' || !result.url) {
        return { error: result.type === 'dismiss' ? null : new Error('Sign-in was cancelled.') };
      }

      const callback = Linking.parse(result.url);
      const params = new URLSearchParams(callback.queryParams as Record<string, string>);
      const fragment = result.url.split('#')[1];
      if (fragment) {
        new URLSearchParams(fragment).forEach((value, key) => params.set(key, value));
      }

      const authError = params.get('error_description') || params.get('error');
      if (authError) return { error: new Error(authError) };

      const code = params.get('code');
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        return { error: exchangeError };
      }

      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        return { error: sessionError };
      }

      return { error: new Error('Sign-in could not be completed. Please try again.') };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    accountType: Profile['account_type'] = 'household',
    avatarUri?: string | null
  ) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // full_name + account_type ride along as user metadata so the DB
          // trigger (handle_new_user) creates the profile row even when the
          // project requires email confirmation (no session is returned yet).
          data: { full_name: fullName, account_type: accountType }
        }
      });

      if (error) return { error };

      // No session -> email confirmation required. The trigger already queued
      // the profile row; do NOT write here (that call would run as anon and
      // violate RLS). Surface a friendly "confirm your email" message instead.
      // A photo picked at signup cannot be stored either, for the same reason —
      // the caller says so, and Profile offers it again once they have confirmed.
      if (!data.session) {
        return { error: null, requiresEmailConfirmation: true };
      }

      // Session present -> profile row exists (trigger) or must be created.
      // The upsert runs authenticated and only touches the caller's own row.
      if (data.user) {
        // Uploaded here rather than from the signup screen because this is the
        // first moment there is a session to upload under — the bucket's policy
        // checks the folder against `auth.uid()`. Doing it before the upsert
        // also means the row lands with its final photo instead of flashing
        // initials first. A failed upload is not worth failing a signup the user
        // has already completed, so it only warns.
        let avatarPath: string | null = null;
        if (avatarUri) {
          try {
            avatarPath = await uploadAvatar(data.user.id, avatarUri);
          } catch (e) {
            console.warn('Avatar upload failed:', e);
          }
        }

        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({
            id: data.user.id,
            email: email,
            full_name: fullName,
            account_type: accountType,
            ...(avatarPath ? { avatar_url: avatarPath } : {}),
          });

        if (profileError) return { error: profileError };
      }

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
      setSession(null);
      setUser(null);
      setProfile(null);
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const signInWithGoogle = async () => {
    return signInWithProvider('google');
  };

  const signInWithFacebook = async () => {
    return signInWithProvider('facebook');
  };

  const resetPassword = async (email: string) => {
    try {
      const redirectUrl = Linking.createURL('reset-password');
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });
      return { error };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const updateProfile = async (data: Partial<Profile>) => {
    if (!user) return { error: new Error('Not authenticated') };
    
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      
      if (!error) {
        await refreshProfile();
      }
      
      return { error };
    } catch (error) {
      return { error: error as Error };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        signIn,
        signUp,
        signOut,
        signInWithGoogle,
        signInWithFacebook,
        resetPassword,
        updateProfile,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
