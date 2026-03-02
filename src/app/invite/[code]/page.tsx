'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Link2, ShieldAlert, Users } from 'lucide-react';
import { useStore } from '../../../lib/store';
import type { ServerInvite } from '../../../lib/types';
import { AuthModal } from '../../../components/modals/AuthModal';
import { isBackendEnabled } from '../../../lib/env';
import { mapBackendUser } from '../../../lib/backend-user';
import { authProvider } from '../../../lib/providers/auth-provider';
import { dataProvider } from '../../../lib/providers/data-provider';

type InviteStatus = 'loading' | 'invalid' | 'revoked' | 'expired' | 'maxed' | 'valid' | 'member';

type RemoteInvitePayload = {
  server: {
    id: string;
    name: string;
    icon: string | null;
    membersCount: number;
  };
  invite: {
    code: string;
    createdBy: string;
    createdAt: string;
    uses: number;
    maxUses: number | null;
    expiresAt: string | null;
    revoked: boolean;
    revokedAt: string | null;
    status: 'valid' | 'revoked' | 'expired' | 'maxed';
  };
  inviter: {
    id: string;
    username: string;
    discriminator: string;
    avatar: string | null;
  } | null;
};

const normalizeInvite = (invite: ServerInvite): ServerInvite => ({
  ...invite,
  maxUses: typeof invite.maxUses === 'number' ? invite.maxUses : null,
  expiresAt: invite.expiresAt ?? null,
  revoked: Boolean(invite.revoked),
  revokedAt: invite.revokedAt ?? null,
});

const isInviteExpired = (invite: ServerInvite): boolean => {
  if (!invite.expiresAt) return false;
  const expiresAtMs = new Date(invite.expiresAt).getTime();
  if (Number.isNaN(expiresAtMs)) return false;
  return expiresAtMs <= Date.now();
};

const isInviteMaxed = (invite: ServerInvite): boolean => {
  if (!invite.maxUses || invite.maxUses <= 0) return false;
  return invite.uses >= invite.maxUses;
};

const getStoredBackendToken = () => {
  try {
    return localStorage.getItem('diavlocord-backend-token');
  } catch {
    return null;
  }
};

const clearStoredBackendSession = () => {
  try {
    localStorage.removeItem('diavlocord-backend-token');
  } catch {}
  try {
    localStorage.removeItem('diavlocord-session');
  } catch {}
};

export default function InvitePage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const codeParam = useMemo(() => {
    const raw = Array.isArray(params?.code) ? params.code[0] : params?.code;
    return decodeURIComponent(raw || '').trim().toLowerCase();
  }, [params]);

  const servers = useStore((s) => s.servers);
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const backendToken = useStore((s) => s.backendToken);
  const joinServerByInvite = useStore((s) => s.joinServerByInvite);
  const loginUser = useStore((s) => s.loginUser);
  const upsertUsers = useStore((s) => s.upsertUsers);
  const setBackendToken = useStore((s) => s.setBackendToken);

  const [hydrated, setHydrated] = useState<boolean>(() => {
    try {
      const persistApi = (useStore as any).persist;
      return persistApi?.hasHydrated?.() ?? true;
    } catch {
      return true;
    }
  });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [joined, setJoined] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  const [sessionReady, setSessionReady] = useState(!isBackendEnabled);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  const [remoteInvite, setRemoteInvite] = useState<RemoteInvitePayload | null>(null);
  const [remoteInviteLoading, setRemoteInviteLoading] = useState(isBackendEnabled);
  const [remoteInviteLoaded, setRemoteInviteLoaded] = useState(!isBackendEnabled);

  useEffect(() => {
    const persistApi = (useStore as any).persist;
    if (!persistApi) {
      setHydrated(true);
      return;
    }
    const unsubHydrate = persistApi.onHydrate?.(() => setHydrated(false));
    const unsubFinish = persistApi.onFinishHydration?.(() => setHydrated(true));
    setHydrated(persistApi.hasHydrated?.() ?? true);
    return () => {
      unsubHydrate?.();
      unsubFinish?.();
    };
  }, []);

  useEffect(() => {
    if (isBackendEnabled) return;
    try {
      const session = localStorage.getItem('diavlocord-session');
      if (session) loginUser(session);
    } catch {}
  }, [loginUser]);

  const ensureBackendSession = useCallback(async () => {
    if (!isBackendEnabled) return null;

    const candidateToken = backendToken || getStoredBackendToken();
    if (!candidateToken) {
      setSessionToken(null);
      setBackendToken(null);
      return null;
    }

    setBackendToken(candidateToken);
    try {
      const res = await authProvider.me(candidateToken);
      const data = await res.json().catch(() => ({}));
      const user = (data as any)?.user;
      if (!res.ok || !user?.id) {
        clearStoredBackendSession();
        setBackendToken(null);
        setSessionToken(null);
        return null;
      }
      const mapped = mapBackendUser(user);
      upsertUsers([mapped]);
      loginUser(mapped.id);
      setSessionToken(candidateToken);
      return candidateToken;
    } catch {
      setSessionToken(candidateToken);
      return candidateToken;
    }
  }, [backendToken, setBackendToken, upsertUsers, loginUser]);

  const loadRemoteInvite = useCallback(async () => {
    if (!isBackendEnabled) return;
    if (!codeParam) {
      setRemoteInvite(null);
      setRemoteInviteLoading(false);
      setRemoteInviteLoaded(true);
      return;
    }

    setRemoteInviteLoading(true);
    setRemoteInviteLoaded(false);
    try {
      const res = await dataProvider.getInvite(codeParam);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRemoteInvite(null);
      } else {
        setRemoteInvite(data as RemoteInvitePayload);
      }
    } catch {
      setRemoteInvite(null);
    } finally {
      setRemoteInviteLoading(false);
      setRemoteInviteLoaded(true);
    }
  }, [codeParam]);

  useEffect(() => {
    let cancelled = false;
    if (!isBackendEnabled) {
      setSessionReady(true);
      return;
    }

    const boot = async () => {
      await ensureBackendSession();
      await loadRemoteInvite();
      if (!cancelled) setSessionReady(true);
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [ensureBackendSession, loadRemoteInvite]);

  const localInviteData = useMemo(() => {
    if (!codeParam) return null;
    for (const server of servers) {
      const invite = (server.invites || [])
        .map((entry) => normalizeInvite(entry))
        .find((entry) => entry.code.toLowerCase() === codeParam);
      if (invite) return { server, invite };
    }
    return null;
  }, [servers, codeParam]);

  const localInviter = useMemo(() => {
    if (!localInviteData?.invite) return null;
    return users.find((u) => u.id === localInviteData.invite.createdBy) || null;
  }, [localInviteData, users]);

  const inviteView = useMemo(() => {
    if (isBackendEnabled) {
      if (!remoteInvite) return null;
      return {
        server: {
          id: remoteInvite.server.id,
          name: remoteInvite.server.name,
          icon: remoteInvite.server.icon,
          membersCount: remoteInvite.server.membersCount,
        },
        invite: remoteInvite.invite,
        inviterName: remoteInvite.inviter?.username || remoteInvite.invite.createdBy,
      };
    }

    if (!localInviteData) return null;
    return {
      server: {
        id: localInviteData.server.id,
        name: localInviteData.server.name,
        icon: localInviteData.server.icon || null,
        membersCount: localInviteData.server.members.length,
      },
      invite: normalizeInvite(localInviteData.invite),
      inviterName: localInviter?.username || localInviteData.invite.createdBy,
    };
  }, [localInviteData, localInviter, remoteInvite]);

  const status: InviteStatus = useMemo(() => {
    if (joined) return 'member';

    if (isBackendEnabled) {
      if (!sessionReady || remoteInviteLoading || !remoteInviteLoaded) return 'loading';
      if (!remoteInvite) return 'invalid';
      if (remoteInvite.invite.status === 'revoked') return 'revoked';
      if (remoteInvite.invite.status === 'expired') return 'expired';
      if (remoteInvite.invite.status === 'maxed') return 'maxed';
      return 'valid';
    }

    if (!hydrated) return 'loading';
    if (!localInviteData) return 'invalid';
    if (localInviteData.invite.revoked) return 'revoked';
    if (isInviteExpired(localInviteData.invite)) return 'expired';
    if (isInviteMaxed(localInviteData.invite)) return 'maxed';
    const alreadyMember = localInviteData.server.members.some((m) => m.userId === currentUser.id);
    if (alreadyMember) return 'member';
    return 'valid';
  }, [
    joined,
    hydrated,
    localInviteData,
    currentUser.id,
    inviteView,
    remoteInviteLoading,
    remoteInviteLoaded,
    sessionReady,
  ]);

  const onAcceptInvite = async () => {
    if (!codeParam || joining || status !== 'valid') return;

    setJoining(true);
    setJoinError('');

    if (!isBackendEnabled) {
      const result = joinServerByInvite(codeParam);
      if (!result.ok) {
        if (result.reason === 'expired') setJoinError('La invitacion expiro.');
        else if (result.reason === 'revoked') setJoinError('La invitacion fue revocada.');
        else if (result.reason === 'maxed') setJoinError('La invitacion alcanzo su limite de usos.');
        else if (result.reason === 'banned') setJoinError('No puedes unirte a este servidor.');
        else if (result.reason === 'not_found' || result.reason === 'invalid') setJoinError('Invitacion no encontrada.');
        else setJoinError('No se pudo aceptar esta invitacion.');
        setJoining(false);
        return;
      }
      setJoined(true);
      setTimeout(() => router.push('/'), 700);
      setJoining(false);
      return;
    }

    try {
      const token = await ensureBackendSession();
      if (!token) {
        setAuthOpen(true);
        return;
      }

      const res = await dataProvider.joinInvite(token, codeParam);
      const data = await res.json().catch(() => ({}));

      if (res.status === 401 || res.status === 403) {
        clearStoredBackendSession();
        setBackendToken(null);
        setSessionToken(null);
        setAuthOpen(true);
        setJoinError('Inicia sesion para aceptar la invitacion.');
        return;
      }

      if (!res.ok) {
        const errorCode = String((data as any)?.error || '');
        if (errorCode === 'invite_expired') setJoinError('La invitacion expiro.');
        else if (errorCode === 'invite_revoked') setJoinError('La invitacion fue revocada.');
        else if (errorCode === 'invite_maxed') setJoinError('La invitacion alcanzo su limite de usos.');
        else if (errorCode === 'invite_not_found') setJoinError('Invitacion no encontrada.');
        else setJoinError('No se pudo aceptar esta invitacion.');
        await loadRemoteInvite();
        return;
      }

      setJoined(true);
      setTimeout(() => router.push('/'), 700);
    } catch {
      setJoinError('Error de conexion.');
    } finally {
      setJoining(false);
    }
  };

  const handleAuthClose = useCallback(() => {
    setAuthOpen(false);
    if (!isBackendEnabled) return;
    void (async () => {
      await ensureBackendSession();
      await loadRemoteInvite();
    })();
  }, [ensureBackendSession, loadRemoteInvite]);

  const statusTitle: Record<InviteStatus, string> = {
    loading: 'Cargando invitacion...',
    invalid: 'Invitacion no encontrada',
    revoked: 'Invitacion revocada',
    expired: 'Invitacion expirada',
    maxed: 'Invitacion sin usos disponibles',
    valid: 'Invitacion lista para aceptar',
    member: 'Ya formas parte de este servidor',
  };

  const statusBody: Record<InviteStatus, string> = {
    loading: isBackendEnabled ? 'Consultando invitacion en el backend.' : 'Sincronizando datos locales de DiavloCord.',
    invalid: isBackendEnabled
      ? 'Este enlace no existe, se elimino o todavia no se sincronizo.'
      : 'Este codigo no existe en este entorno. Si abres en otro navegador, importa tu estado o crea la invitacion ahi.',
    revoked: 'El enlace fue revocado por administracion.',
    expired: 'El tiempo limite de esta invitacion ya termino.',
    maxed: 'Se alcanzo el maximo de usos para esta invitacion.',
    valid: isBackendEnabled && !sessionToken
      ? 'Necesitas iniciar sesion para aceptar esta invitacion.'
      : 'Pulsa aceptar para unirte al servidor.',
    member: 'Puedes volver directamente al chat principal.',
  };

  return (
    <div
      className="min-h-screen w-full relative overflow-hidden bg-cover bg-center"
      style={{
        backgroundImage: 'url(/background_login.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="absolute inset-0 bg-black/72 backdrop-blur-md" />
      <div className="absolute inset-0 bg-layer pointer-events-none">
        <div className="scanline-overlay" />
        <div className="noise-soft" />
      </div>

      <div className="relative z-10 min-h-screen p-6 flex items-center justify-center">
        <div className="w-full max-w-[560px] bg-[#0B0C10]/78 glass-ruby-surface backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden room-enter popup-boost popup-glow">
          <div className="px-6 py-4 border-b border-white/10 bg-white/[0.02] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.25em] text-[#949BA4]">DiavloCord Invite</div>
              <div className="text-white text-lg font-black truncate">{inviteView?.server.name || 'Invite Link'}</div>
            </div>
            <button
              onClick={() => router.push('/')}
              className="h-9 px-3 rounded-xl bg-white/[0.03] border border-white/10 text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest"
            >
              <ArrowLeft size={14} />
              Volver
            </button>
          </div>

          <div className="p-6">
            <div className="flex items-center gap-4 mb-5">
              <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/15 bg-black/35 flex items-center justify-center text-2xl font-black text-white">
                {inviteView?.server.icon ? (
                  <img src={inviteView.server.icon} alt={inviteView.server.name} className="w-full h-full object-cover" />
                ) : (
                  <span>{inviteView?.server.name?.[0]?.toUpperCase() || 'D'}</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-1">Estado</div>
                <div className="text-white text-xl font-black tracking-tight">{statusTitle[status]}</div>
                <div className="text-sm text-[#B5BAC1] mt-1">{statusBody[status]}</div>
              </div>
            </div>

            {inviteView ? (
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4 mb-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                    <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#7b838a]">Invitador</div>
                    <div className="text-sm font-black text-white truncate mt-1">{inviteView.inviterName}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                    <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#7b838a]">Miembros</div>
                    <div className="text-sm font-black text-white mt-1 inline-flex items-center gap-1.5">
                      <Users size={13} className="text-neon-green" />
                      {inviteView.server.membersCount}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                    <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#7b838a]">Codigo</div>
                    <div className="text-sm font-black text-white truncate mt-1 inline-flex items-center gap-1.5">
                      <Link2 size={13} className="text-neon-blue" />
                      {inviteView.invite.code}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {joinError ? (
              <div className="mb-4 rounded-xl border border-neon-pink/35 bg-neon-pink/10 px-3 py-2 text-sm text-neon-pink font-bold inline-flex items-center gap-2">
                <ShieldAlert size={14} />
                {joinError}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => router.push('/')}
                className="h-11 px-5 rounded-xl bg-white/[0.03] border border-white/10 text-white font-black uppercase tracking-widest text-[10px] hover:bg-white/[0.08] transition-colors"
              >
                Ir al inicio
              </button>

              {status === 'valid' ? (
                <button
                  onClick={onAcceptInvite}
                  disabled={joining || joined}
                  className="h-11 px-6 rounded-xl text-black bg-neon-green font-black uppercase tracking-widest text-[10px] hover:scale-[1.02] active:scale-[0.99] transition-all disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  <CheckCircle2 size={15} />
                  {joining
                    ? 'Procesando...'
                    : joined
                      ? 'Aceptado'
                      : isBackendEnabled && !sessionToken
                        ? 'Iniciar sesion y aceptar'
                        : 'Aceptar invitacion'}
                </button>
              ) : status === 'member' ? (
                <button
                  onClick={() => router.push('/')}
                  className="h-11 px-6 rounded-xl text-black bg-neon-green font-black uppercase tracking-widest text-[10px] hover:scale-[1.02] active:scale-[0.99] transition-all inline-flex items-center gap-2"
                >
                  <CheckCircle2 size={15} />
                  Abrir servidor
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <AuthModal open={authOpen} onClose={handleAuthClose} />
    </div>
  );
}
