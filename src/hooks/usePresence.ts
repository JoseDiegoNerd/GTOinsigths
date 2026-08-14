import { useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import type { CargoUsuario, PresencaUsuario } from '../types/gto';

const PRESENCE_CHANNEL = 'online-users';

type PresenceMeta = {
  nome: string;
  email: string;
  cargo: CargoUsuario | null;
  online_at: string;
};

// Mantém a sessão logada marcada como "online" no canal de presença compartilhado enquanto o
// app estiver aberto nesta aba. Chamado uma vez na raiz do App para qualquer cargo - a tela de
// Gestão de Usuários (useOnlineUsers) é quem lê o estado agregado disso.
export function usePresenceHeartbeat(params: {
  userId: string | null;
  nome: string;
  email: string;
  cargo: CargoUsuario | null;
}) {
  const { userId, nome, email, cargo } = params;

  useEffect(() => {
    if (!userId) return;

    const channel = supabase.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: userId } }
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        const meta: PresenceMeta = { nome, email, cargo, online_at: new Date().toISOString() };
        channel.track(meta);
      }
    });

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, [userId, nome, email, cargo]);
}

// Lê o estado agregado do canal 'online-users' (quem está com presença ativa agora). Não marca
// a própria sessão de quem chama - isso já é feito por usePresenceHeartbeat na raiz do app.
export function useOnlineUsers(): PresencaUsuario[] {
  const [online, setOnline] = useState<PresencaUsuario[]>([]);

  useEffect(() => {
    const channel: RealtimeChannel = supabase.channel(PRESENCE_CHANNEL);

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<PresenceMeta>();
      const users = Object.entries(state).map(([userId, presences]) => {
        const latest = presences[0];
        return {
          userId,
          nome: latest?.nome || 'Usuário',
          email: latest?.email || '',
          cargo: latest?.cargo ?? null,
          onlineAt: latest?.online_at || new Date().toISOString()
        };
      });
      setOnline(users);
    });

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return online;
}
