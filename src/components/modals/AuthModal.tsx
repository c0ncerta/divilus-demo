import React, { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useStore } from '../../lib/store';
import { t } from '../../lib/i18n';
import { env, isBackendEnabled } from '../../lib/env';
import { mapBackendUser } from '../../lib/backend-user';
import { authProvider } from '../../lib/providers/auth-provider';
import { dataProvider } from '../../lib/providers/data-provider';
import { ModalBase } from '../ui/ModalBase';

type Props = {
  open: boolean;
  onClose: () => void;
};

type AuthMode = 'login' | 'register' | 'recovery';
const REQUEST_TIMEOUT_MS = Math.max(15000, Number(process.env.NEXT_PUBLIC_AUTH_REQUEST_TIMEOUT_MS || 45000));
const NETWORK_RETRY_ATTEMPTS = Math.max(1, Number(process.env.NEXT_PUBLIC_AUTH_NETWORK_RETRIES || 2));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const AuthModal = ({ open, onClose }: Props) => {
  const registerUserWithPassword = useStore(state => state.registerUserWithPassword);
  const loginUserWithPassword = useStore(state => state.loginUserWithPassword);
  const recoverPasswordWithCode = useStore(state => state.recoverPasswordWithCode);
  const upsertUsers = useStore(state => state.upsertUsers);
  const { language } = useStore();
  
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [backendCheckState, setBackendCheckState] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [backendCheckMessage, setBackendCheckMessage] = useState('');
  const inputRef = useRef<HTMLInputElement|null>(null);

  useEffect(() => {
    if (!open) {
      setError('');
      setSuccess('');
      setGeneratedCode('');
      setIsSubmitting(false);
    } else {
      const id = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(id);
    }
  }, [open, mode]);

  if (!open) return null;

  const hydrateBackendData = async (token: string) => {
    try {
      const res = await dataProvider.bootstrap(token, {
        includeUsers: true,
        includeMessages: true,
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) return;

      const users = Array.isArray((data as any).users)
        ? (data as any).users.map((u: any) => mapBackendUser(u))
        : [];
      upsertUsers(users);

      const dmGroups = Array.isArray((data as any).dmConversations)
        ? (data as any).dmConversations.map((c: any) => ({
            id: c.id,
            memberIds: Array.isArray(c.memberIds) ? c.memberIds : [],
          }))
        : [];

      const dmMessages = Array.isArray((data as any).dmConversations)
        ? (data as any).dmConversations.reduce((acc: Record<string, any[]>, c: any) => {
            const list = Array.isArray(c.messages) ? c.messages : [];
            acc[c.id] = list.map((m: any) => ({
              id: m.id,
              channelId: c.id,
              authorId: m.authorId,
              content: m.content || '',
              timestamp: m.createdAt,
              attachments: Array.isArray(m.attachments) && m.attachments.length > 0 ? m.attachments : undefined,
            }));
            return acc;
          }, {})
        : {};

      useStore.setState((st: any) => ({
        ...(function () {
          const previousDmIds = new Set((st.dmGroups || []).map((g: any) => g.id));
          const preservedMessages = Object.fromEntries(
            Object.entries(st.messages || {}).filter(([channelId]) => !previousDmIds.has(channelId))
          );
          return {
            messages: {
              ...preservedMessages,
              ...dmMessages,
            },
          };
        })(),
        dmGroups,
        pinnedDmIds: Array.isArray(st.pinnedDmIds)
          ? st.pinnedDmIds.filter((id: string) => dmGroups.some((g: any) => g?.id === id))
          : [],
        dmRequestsIncoming: Array.isArray((data as any).dmRequestsIncoming)
          ? (data as any).dmRequestsIncoming.map((r: any) => ({
              id: r.id,
              fromUserId: r.fromUserId,
              toUserId: r.toUserId,
              createdAt: r.createdAt,
            }))
          : [],
        dmRequestsOutgoing: Array.isArray((data as any).dmRequestsOutgoing)
          ? (data as any).dmRequestsOutgoing.map((r: any) => ({
              id: r.id,
              fromUserId: r.fromUserId,
              toUserId: r.toUserId,
              createdAt: r.createdAt,
            }))
          : [],
      }));
    } catch {}
  };

  const requestWithTimeout = async (request: (signal: AbortSignal) => Promise<Response>) => {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= NETWORK_RETRY_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        return await request(controller.signal);
      } catch (err) {
        lastError = err;
        const retryable = err instanceof TypeError || (err instanceof DOMException && err.name === 'AbortError');
        if (!retryable || attempt >= NETWORK_RETRY_ATTEMPTS) {
          throw err;
        }
        await wait(900 * attempt);
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new Error('network_request_failed');
  };

  const getNetworkErrorMessage = (err: unknown) => {
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && env.apiUrl.startsWith('http://')) {
      return 'La web usa HTTPS y la API esta en HTTP. Configura NEXT_PUBLIC_API_URL con https://';
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      return 'El servidor tarda demasiado en responder. Intentalo otra vez en unos segundos.';
    }
    return 'Error de conexion con el servidor. Verifica que el backend este online y con CORS correcto.';
  };

  const getBackendStatusMessage = (status: number) => {
    if (status === 503) {
      return 'Backend temporalmente no disponible (base de datos/saturacion). Intentalo en unos minutos.';
    }
    if (status >= 500) {
      return 'Error interno del backend. Revisa Render/Neon e intentalo de nuevo.';
    }
    return '';
  };

  const handleLogin = async () => {
    if (isSubmitting) return;
    setError('');
    setSuccess('');
    if (!username.trim() || !password.trim()) {
      setError('Por favor rellena todos los campos');
      return;
    }

    setIsSubmitting(true);
    try {
      if (!isBackendEnabled) {
        if (loginUserWithPassword(username, password)) {
          setSuccess('Sesion iniciada correctamente');
          setTimeout(() => {
            setUsername('');
            setPassword('');
            onClose();
          }, 1000);
        } else {
          setError('Usuario o contrasena incorrectos');
        }
        return;
      }

      const res = await requestWithTimeout((signal) =>
        authProvider.login({ username: username.trim(), password }, signal)
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const backendStatusMessage = getBackendStatusMessage(res.status);
        if (backendStatusMessage) {
          setError(backendStatusMessage);
          return;
        }
        setError('Usuario o contrasena incorrectos');
        return;
      }

      const { token, user } = data as any;
      if (token) {
        try { localStorage.setItem('diavlocord-backend-token', token); } catch {}
        try { localStorage.setItem('diavlocord-session', user?.id || ''); } catch {}
        try { useStore.getState().setBackendToken(token); } catch {}
      }

      if (user?.id) {
        const mapped = mapBackendUser(user);
        upsertUsers([mapped]);
        useStore.getState().loginUser(mapped.id);
        if (token) {
          await hydrateBackendData(token);
        }
      }

      setSuccess('Sesion iniciada correctamente');
      setTimeout(() => {
        setUsername('');
        setPassword('');
        onClose();
      }, 900);
    } catch (err) {
      setError(getNetworkErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async () => {
    if (isSubmitting) return;
    setError('');
    setSuccess('');
    if (!username.trim() || !password.trim() || !confirmPassword.trim()) {
      setError('Por favor rellena todos los campos');
      return;
    }
    if (username.trim().length < 3) {
      setError('El usuario debe tener al menos 3 caracteres');
      return;
    }
    if (password.length < 6) {
      setError('La contrasena debe tener al menos 6 caracteres');
      return;
    }
    if (password !== confirmPassword) {
      setError('Las contrasenas no coinciden');
      return;
    }

    setIsSubmitting(true);
    try {
      if (!isBackendEnabled) {
        const result = registerUserWithPassword({
          username: username.trim(),
          password,
        });

        setGeneratedCode(result.recoveryCode);
        setSuccess('Cuenta creada. Guarda tu codigo de recuperacion');
        return;
      }

      const res = await requestWithTimeout((signal) =>
        authProvider.register({ username: username.trim(), password }, signal)
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const backendStatusMessage = getBackendStatusMessage(res.status);
        if (backendStatusMessage) {
          setError(backendStatusMessage);
          return;
        }
        const errorCode = (data as any)?.error;
        if (res.status === 409 || errorCode === 'username_taken') {
          setError('Ese usuario ya existe');
          return;
        }
        setError('No se pudo crear la cuenta');
        return;
      }

      const { token, user, recoveryCode: backendRecoveryCode } = data as any;
      if (token) {
        try { localStorage.setItem('diavlocord-backend-token', token); } catch {}
        try { localStorage.setItem('diavlocord-session', user?.id || ''); } catch {}
        try { useStore.getState().setBackendToken(token); } catch {}
      }

      if (user?.id) {
        const mapped = mapBackendUser(user);
        upsertUsers([mapped]);
        useStore.getState().loginUser(mapped.id);
        if (token) {
          await hydrateBackendData(token);
        }
      }

      if (typeof backendRecoveryCode === 'string' && backendRecoveryCode.trim().length > 0) {
        setGeneratedCode(backendRecoveryCode.trim());
        setSuccess('Cuenta creada. Guarda tu codigo de recuperacion');
        return;
      }

      setSuccess('Cuenta creada');
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err) {
      setError(getNetworkErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRecovery = async () => {
    if (isSubmitting) return;
    setError('');
    setSuccess('');
    if (!username.trim() || !recoveryCode.trim() || !password.trim()) {
      setError('Por favor rellena todos los campos');
      return;
    }

    setIsSubmitting(true);
    try {
      if (!isBackendEnabled) {
        if (recoverPasswordWithCode(username, recoveryCode, password)) {
          setSuccess('Contrasena recuperada. Inicia sesion con tu nueva contrasena');
          setTimeout(() => {
            setMode('login');
            setUsername('');
            setPassword('');
            setRecoveryCode('');
          }, 2000);
        } else {
          setError('Usuario o codigo de recuperacion incorrectos');
        }
        return;
      }

      const res = await requestWithTimeout((signal) =>
        authProvider.recover(
          {
            username: username.trim(),
            recoveryCode: recoveryCode.trim(),
            newPassword: password,
          },
          signal
        )
      );
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        const backendStatusMessage = getBackendStatusMessage(res.status);
        if (backendStatusMessage) {
          setError(backendStatusMessage);
          return;
        }
        setError('Usuario o codigo de recuperacion incorrectos');
        return;
      }

      const nextRecoveryCode =
        typeof (data as any).recoveryCode === 'string'
          ? String((data as any).recoveryCode).trim()
          : '';

      if (nextRecoveryCode) {
        setGeneratedCode(nextRecoveryCode);
        setMode('register');
        setSuccess('Contrasena actualizada. Guarda tu nuevo codigo de recuperacion');
        return;
      }

      setSuccess('Contrasena recuperada. Inicia sesion con tu nueva contrasena');
      setTimeout(() => {
        setMode('login');
        setPassword('');
        setRecoveryCode('');
      }, 1200);
    } catch (err) {
      setError(getNetworkErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackendCheck = async () => {
    if (!isBackendEnabled || !env.apiUrl || backendCheckState === 'checking') return;
    setBackendCheckState('checking');
    setBackendCheckMessage('');
    try {
      const res = await requestWithTimeout((signal) => authProvider.health(signal));
      if (res.ok) {
        setBackendCheckState('ok');
        setBackendCheckMessage('Backend online y respondiendo.');
        return;
      }
      setBackendCheckState('error');
      setBackendCheckMessage(`Backend responde con estado ${res.status}.`);
    } catch (err) {
      setBackendCheckState('error');
      setBackendCheckMessage(getNetworkErrorMessage(err));
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const authTitleId = 'auth-modal-title';
  const authDescriptionId = 'auth-modal-description';

  return (
    <ModalBase
      open={open}
      onClose={onClose}
      rootClassName="z-[600]"
      rootStyle={{
        backgroundImage: 'url(/background_login.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
      ariaLabelledBy={authTitleId}
      ariaDescribedBy={authDescriptionId}
      closeOnOverlayClick={false}
      panelClassName="relative w-full max-w-md z-10"
    >
        <div className="bg-[#0B0C10]/75 glass-ruby-surface backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          
          {/* Header */}
          <div className="mb-8">
            <h1 id={authTitleId} className="text-3xl font-semibold text-white mb-2 tracking-tight">DiavloCord</h1>
            <p id={authDescriptionId} className="text-white/60">
              {mode === 'login' && t(language, 'login_title')}
              {mode === 'register' && t(language, 'register_title')}
              {mode === 'recovery' && t(language, 'recovery_title')}
            </p>
          </div>

          {/* Success Message */}
          {success && (
            <div className="mb-4 p-3 rounded-lg bg-neon-green/10 border border-neon-green/30 text-neon-green text-sm font-semibold" aria-live="polite">
              {success}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-neon-pink/10 border border-neon-pink/30 text-neon-pink text-sm font-semibold" role="alert" aria-live="assertive">
              {error}
            </div>
          )}

          {/* Login Form */}
          {mode === 'login' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-white/60 uppercase tracking-widest block mb-2">
                  {t(language, 'username')}
                </label>
                <input 
                  ref={inputRef}
                  type="text"
                  value={username} 
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') void handleLogin();
                  }}
                  placeholder="tu_usuario" 
                  className="w-full bg-white/[0.04] border border-white/10 rounded-xl py-3 px-4 outline-none text-white placeholder-white/30 focus:border-[#7A1027]/60 focus:bg-white/[0.06] transition-colors"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-white/60 uppercase tracking-widest block mb-2">
                  {t(language, 'password')}
                </label>
                <input 
                  type="password"
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') void handleLogin();
                  }}
                  placeholder="********" 
                  className="w-full bg-white/[0.04] border border-white/10 rounded-xl py-3 px-4 outline-none text-white placeholder-white/30 focus:border-[#7A1027]/60 focus:bg-white/[0.06] transition-colors"
                />
              </div>

              <button
                onClick={() => {
                  void handleLogin();
                }}
                disabled={!username || !password || isSubmitting}
                className="w-full mt-6 px-4 py-3 rounded-xl font-semibold bg-[#7A1027] text-white hover:bg-[#5B0C1C] transition-colors disabled:bg-white/[0.04] disabled:text-white/30"
              >
                {isSubmitting ? 'Conectando...' : t(language, 'login')}
              </button>

              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => {
                    setMode('register');
                    setError('');
                  }}
                  disabled={isSubmitting}
                  className="flex-1 text-neon-green hover:underline font-semibold"
                >
                  {t(language, 'create_account')}
                </button>
                <button
                  onClick={() => {
                    setMode('recovery');
                    setError('');
                  }}
                  disabled={isSubmitting}
                  className="flex-1 text-neon-purple hover:underline font-semibold"
                >
                  {t(language, 'recover')}
                </button>
              </div>
            </div>
          )}

          {/* Register Form */}
          {mode === 'register' && (
            <div className="space-y-4">
              {!generatedCode ? (
                <>
                  <div>
                    <label className="text-xs font-semibold text-white/60 uppercase tracking-widest block mb-2">
                      {t(language, 'username')}
                    </label>
                    <input 
                      ref={inputRef}
                      type="text"
                      value={username} 
                      onChange={(e) => setUsername(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') void handleRegister();
                      }}
                      placeholder="tu_usuario" 
                      className="w-full bg-white/[0.04] border border-white/10 rounded-xl py-3 px-4 outline-none text-white placeholder-white/30 focus:border-[#7A1027]/60 focus:bg-white/[0.06] transition-colors"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-white/60 uppercase tracking-widest block mb-2">
                      {t(language, 'password')}
                    </label>
                    <input 
                      type="password"
                      value={password} 
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') void handleRegister();
                      }}
                      placeholder="********" 
                      className="w-full bg-white/[0.04] border border-white/10 rounded-xl py-3 px-4 outline-none text-white placeholder-white/30 focus:border-[#7A1027]/60 focus:bg-white/[0.06] transition-colors"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-white/60 uppercase tracking-widest block mb-2">
                      {t(language, 'confirm_password')}
                    </label>
                    <input 
                      type="password"
                      value={confirmPassword} 
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') void handleRegister();
                      }}
                      placeholder="********" 
                      className="w-full bg-white/[0.04] border border-white/10 rounded-xl py-3 px-4 outline-none text-white placeholder-white/30 focus:border-[#7A1027]/60 focus:bg-white/[0.06] transition-colors"
                    />
                  </div>

                  <button
                    onClick={() => {
                      void handleRegister();
                    }}
                    disabled={!username || !password || !confirmPassword || isSubmitting}
                    className="w-full mt-6 px-4 py-3 rounded-xl font-semibold bg-neon-green text-black hover:bg-neon-green/90 transition-colors"
                  >
                    {isSubmitting ? 'Creando cuenta...' : t(language, 'create_account')}
                  </button>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-neon-green/10 border border-neon-green/30">
                    <p className="text-xs font-black text-neon-green uppercase tracking-widest mb-3">
                      {t(language, 'recovery_generated')}
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-black/40 p-3 rounded-lg text-white font-mono text-sm break-all border border-white/10">
                        {generatedCode}
                      </code>
                      <button
                        onClick={copyToClipboard}
                        className="p-3 bg-neon-green/20 hover:bg-neon-green/30 rounded-lg text-neon-green transition-colors"
                        title="Copiar al portapapeles"
                      >
                        {copied ? <Check size={18} /> : <Copy size={18} />}
                      </button>
                    </div>
                  </div>
                  
                  <p className="text-xs text-white/50 text-center font-semibold">
                    AVISO: {t(language, 'recovery_save_warning')}
                  </p>

                  <button
                    onClick={() => {
                      setMode('login');
                      setUsername('');
                      setPassword('');
                      setConfirmPassword('');
                      setGeneratedCode('');
                    }}
                    disabled={isSubmitting}
                    className="w-full px-4 py-3 rounded-xl font-semibold bg-[#7A1027] text-white hover:bg-[#5B0C1C] transition-colors"
                  >
                    {t(language, 'go_to_login')}
                  </button>
                </div>
              )}

              {!generatedCode && (
                <button
                  onClick={() => {
                    setMode('login');
                    setError('');
                  }}
                  disabled={isSubmitting}
                  className="w-full text-neon-purple hover:underline font-semibold text-xs"
                >
                  {t(language, 'back_to_login')}
                </button>
              )}
            </div>
          )}

          {/* Recovery Form */}
          {mode === 'recovery' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-white/60 uppercase tracking-widest block mb-2">
                  {t(language, 'username')}
                </label>
                <input 
                  ref={inputRef}
                  type="text"
                  value={username} 
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') void handleRecovery();
                  }}
                  placeholder="tu_usuario" 
                  className="w-full bg-white/[0.04] border border-white/10 rounded-xl py-3 px-4 outline-none text-white placeholder-white/30 focus:border-[#7A1027]/60 focus:bg-white/[0.06] transition-colors"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-white/60 uppercase tracking-widest block mb-2">
                  {t(language, 'recovery_code')}
                </label>
                <input 
                  type="text"
                  value={recoveryCode} 
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') void handleRecovery();
                  }}
                  placeholder="XXXX-XXXX" 
                  className="w-full bg-white/[0.04] border border-white/10 rounded-xl py-3 px-4 outline-none text-white placeholder-white/30 focus:border-[#7A1027]/60 focus:bg-white/[0.06] transition-colors font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-white/60 uppercase tracking-widest block mb-2">
                  {t(language, 'new_password')}
                </label>
                <input 
                  type="password"
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') void handleRecovery();
                  }}
                  placeholder="********" 
                  className="w-full bg-white/[0.04] border border-white/10 rounded-xl py-3 px-4 outline-none text-white placeholder-white/30 focus:border-[#7A1027]/60 focus:bg-white/[0.06] transition-colors"
                />
              </div>

              <button
                onClick={() => {
                  void handleRecovery();
                }}
                disabled={!username || !recoveryCode || !password || isSubmitting}
                className="w-full mt-6 px-4 py-3 rounded-xl font-semibold bg-[#7A1027] text-white hover:bg-[#5B0C1C] transition-colors"
              >
                {isSubmitting ? 'Recuperando...' : t(language, 'recover_password')}
              </button>

              <button
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
                disabled={isSubmitting}
                className="w-full text-neon-purple hover:underline font-semibold text-xs"
              >
                {t(language, 'back_to_login')}
              </button>
            </div>
          )}

          {isBackendEnabled && (
            <div className="mt-6 pt-4 border-t border-white/10 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-white/45 font-mono truncate">
                  API: {env.apiUrl || 'no configurada'}
                </span>
                <button
                  onClick={() => {
                    void handleBackendCheck();
                  }}
                  disabled={backendCheckState === 'checking'}
                  className="text-[10px] px-3 py-1 rounded-md border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors disabled:opacity-50"
                >
                  {backendCheckState === 'checking' ? 'Comprobando...' : 'Probar backend'}
                </button>
              </div>
              {backendCheckMessage && (
                <p className={`text-[11px] ${backendCheckState === 'ok' ? 'text-neon-green' : 'text-neon-pink'}`}>
                  {backendCheckMessage}
                </p>
              )}
            </div>
          )}
        </div>
    </ModalBase>
  );
};
