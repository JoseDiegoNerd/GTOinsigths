import { useCallback, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { toSafeErrorMessage } from '../lib/errorHandling';
import type { Perfil } from '../types/gto';

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPerfil = useCallback(async (userId: string) => {
    const { data, error: perfilError } = await supabase
      .from('perfis')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (perfilError) throw perfilError;
    setPerfil(data);
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!active) return;
        setSession(data.session);
        setUser(data.session?.user ?? null);
        if (data.session?.user) {
          await loadPerfil(data.session.user.id);
        }
      })
      .catch((authError) => setError(toSafeErrorMessage(authError, 'Não foi possível carregar sua sessão.')))
      .finally(() => setLoading(false));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (nextSession?.user) {
        loadPerfil(nextSession.user.id).catch((authError) =>
          setError(toSafeErrorMessage(authError, 'Não foi possível carregar seu perfil.'))
        );
      } else {
        setPerfil(null);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [loadPerfil]);

  async function signIn(email: string, password: string) {
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(toSafeErrorMessage(signInError, 'Não foi possível entrar. Tente novamente.'));
      throw signInError;
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return {
    session,
    user,
    perfil,
    loading,
    error,
    signIn,
    signOut,
    refreshPerfil: () => (user ? loadPerfil(user.id) : Promise.resolve())
  };
}
