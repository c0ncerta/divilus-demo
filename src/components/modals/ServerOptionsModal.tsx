import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../lib/store';
import { Settings, Copy, LogOut, Trash2, Check, Link2, X, ChevronDown } from 'lucide-react';
import { t } from '../../lib/i18n';
import { ModalBase } from '../ui/ModalBase';

interface ServerOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverId: string | null;
  onOpenServerSettings: () => void;
}

type FlowSelectOption = {
  value: number;
  label: string;
};

interface FlowGlassSelectProps {
  value: number;
  options: FlowSelectOption[];
  onChange: (nextValue: number) => void;
  ariaLabel: string;
}

const FlowGlassSelect = ({ value, options, onChange, ariaLabel }: FlowGlassSelectProps) => {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selected = options.find((option) => option.value === value) || options[0] || null;

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timeoutId = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(timeoutId);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const onDocDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || !rootRef.current) return;
      if (!rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mounted]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={[
          "w-full h-11 rounded-2xl px-3.5 text-left inline-flex items-center gap-2",
          "bg-white/[0.06] border border-white/12 backdrop-blur-md text-white",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_24px_rgba(0,0,0,0.22)]",
          "transition-all hover:bg-white/[0.08] hover:border-[#7A1027]/35 focus:outline-none focus-visible:border-[#7A1027]/60",
        ].join(" ")}
      >
        <span className="truncate text-sm font-semibold">{selected?.label || ''}</span>
        <ChevronDown
          size={16}
          className={[
            "ml-auto text-white/65 transition-transform duration-200",
            open ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>

      {mounted ? (
        <div
          className={[
            "absolute left-0 right-0 top-[calc(100%+8px)] z-[780] origin-top",
            open ? "mac-scale-enter" : "mac-scale-exit pointer-events-none",
          ].join(" ")}
        >
          <div
            role="listbox"
            aria-label={ariaLabel}
            className="rounded-2xl border border-white/12 bg-[#0B0C10]/94 glass-ruby-surface backdrop-blur-xl p-2 shadow-[0_20px_40px_rgba(0,0,0,0.58),0_0_0_1px_rgba(255,255,255,0.04)] max-h-56 overflow-y-auto custom-scrollbar"
          >
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={`invite-flow-select-${option.value}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={[
                    "w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-all border",
                    active
                      ? "bg-[#7A1027]/35 border-[#7A1027]/55 text-white shadow-[0_8px_20px_rgba(122,16,39,0.28)]"
                      : "bg-transparent border-transparent text-[#CFD4DA] hover:bg-white/[0.06] hover:border-white/12",
                  ].join(" ")}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const ServerOptionsModal = ({ isOpen, onClose, serverId, onOpenServerSettings }: ServerOptionsModalProps) => {
  const { servers, leaveServer, deleteServer, currentUser, language } = useStore();
  const createServerInviteLink = useStore((state) => state.createServerInviteLink);
  const [mounted, setMounted] = useState(isOpen);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [inviteBuilderMounted, setInviteBuilderMounted] = useState(false);
  const [inviteBuilderVisible, setInviteBuilderVisible] = useState(false);
  const [quickInviteExpiry, setQuickInviteExpiry] = useState<number>(24);
  const [quickInviteMaxUses, setQuickInviteMaxUses] = useState<number>(0);
  const [inviteBusy, setInviteBusy] = useState(false);
  
  const server = serverId ? servers.find(s => s.id === serverId) : null;
  const isOwner = server ? server.ownerId === currentUser.id : false;

  const expiryOptions: FlowSelectOption[] = language === 'es'
    ? [
        { value: 1, label: '1 hora' },
        { value: 6, label: '6 horas' },
        { value: 12, label: '12 horas' },
        { value: 24, label: '1 dia' },
        { value: 72, label: '3 dias' },
        { value: 168, label: '1 semana' },
        { value: 0, label: t(language, 'invite_unlimited') },
      ]
    : [
        { value: 1, label: '1 hour' },
        { value: 6, label: '6 hours' },
        { value: 12, label: '12 hours' },
        { value: 24, label: '1 day' },
        { value: 72, label: '3 days' },
        { value: 168, label: '1 week' },
        { value: 0, label: t(language, 'invite_unlimited') },
      ];

  const maxUsesOptions: FlowSelectOption[] = language === 'es'
    ? [
        { value: 0, label: t(language, 'invite_unlimited') },
        { value: 1, label: '1 uso' },
        { value: 5, label: '5 usos' },
        { value: 10, label: '10 usos' },
        { value: 25, label: '25 usos' },
        { value: 50, label: '50 usos' },
        { value: 100, label: '100 usos' },
      ]
    : [
        { value: 0, label: t(language, 'invite_unlimited') },
        { value: 1, label: '1 use' },
        { value: 5, label: '5 uses' },
        { value: 10, label: '10 uses' },
        { value: 25, label: '25 uses' },
        { value: 50, label: '50 uses' },
        { value: 100, label: '100 uses' },
      ];

  useEffect(() => {
    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (isOpen) {
      setMounted(true);
      rafId = requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
      timeoutId = setTimeout(() => setMounted(false), 360);
    }

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) return;
    setInviteBuilderVisible(false);
    const timeoutId = setTimeout(() => setInviteBuilderMounted(false), 260);
    return () => clearTimeout(timeoutId);
  }, [isOpen]);

  if (!isOpen || !server || !mounted) return null;

  const handleLeaveServer = () => {
    if (serverId) {
      if (isOwner) return;
      leaveServer(serverId);
      onClose();
    }
  };

  const handleCopyId = () => {
    if (serverId) {
      navigator.clipboard.writeText(serverId).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const handleCreateInviteLink = async (copyImmediately = false) => {
    if (!serverId) return;
    setInviteBusy(true);
    const inviteLink = createServerInviteLink(serverId, {
      expiresInHours: quickInviteExpiry > 0 ? quickInviteExpiry : null,
      maxUses: quickInviteMaxUses > 0 ? quickInviteMaxUses : null,
    });
    if (!inviteLink) {
      setInviteBusy(false);
      return;
    }
    setLastInviteLink(inviteLink);
    if (copyImmediately) {
      try {
        await navigator.clipboard.writeText(inviteLink);
        setInviteCopied(true);
        setTimeout(() => setInviteCopied(false), 2200);
      } catch {
        setInviteCopied(false);
      }
      setInviteBusy(false);
      return;
    }
    setInviteCopied(false);
    setInviteBusy(false);
  };

  const handleCopyInviteLink = async () => {
    if (!lastInviteLink) return;
    try {
      await navigator.clipboard.writeText(lastInviteLink);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2200);
    } catch {
      setInviteCopied(false);
    }
  };

  const handleDelete = () => {
    if (!serverId || !server) return;
    if (server.ownerId !== currentUser.id) return;
    deleteServer(serverId);
    onClose();
  };

  const handleSettings = () => {
    onClose();
    onOpenServerSettings();
  };

  const openInviteBuilder = () => {
    setInviteBuilderMounted(true);
    requestAnimationFrame(() => setInviteBuilderVisible(true));
  };

  const closeInviteBuilder = () => {
    setInviteBuilderVisible(false);
    setTimeout(() => setInviteBuilderMounted(false), 260);
  };

  return (
    <>
      <ModalBase
        open={mounted}
        onClose={onClose}
        ariaLabelledBy="server-options-modal-title"
        ariaDescribedBy="server-options-modal-description"
        closeOnEscape={!inviteBuilderMounted}
        closeOnOverlayClick={!inviteBuilderMounted}
        rootClassName="z-[510]"
        overlayClassName={[
          'mac-glass-backdrop transition-opacity duration-300',
          visible ? 'opacity-100 bg-black/8' : 'opacity-0 pointer-events-none bg-transparent',
        ].join(' ')}
        containerClassName="pointer-events-none p-0"
        panelClassName={[
          'pointer-events-auto fixed top-20 left-[96px] origin-top-left',
          visible ? 'mac-genie-enter' : 'mac-genie-exit',
        ].join(' ')}
      >
        <div className="bg-[#0B0C10]/88 glass-ruby-surface rounded-2xl overflow-hidden shadow-2xl border border-white/10 w-72">
          <div className="px-5 py-4 border-b border-white/10 bg-white/[0.02]">
            <h3 id="server-options-modal-title" className="text-[15px] font-semibold text-white truncate">
              {server.name}
            </h3>
            <p id="server-options-modal-description" className="text-xs text-white/50 mt-1">
              ID: {server.id.slice(0, 12)}...
            </p>
          </div>

          <div className="py-2">
            <button
              type="button"
              onClick={handleSettings}
              className="w-full flex items-center justify-between px-4 py-2.5 text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors text-[14px]"
            >
              <span className="flex items-center gap-2">
                <span className="font-semibold">{t(language, 'configuration')}</span>
              </span>
              <span className="text-white/60">
                <Settings size={16} />
              </span>
            </button>

            <button
              type="button"
              onClick={openInviteBuilder}
              className="w-full flex items-center justify-between px-4 py-2.5 text-neon-green hover:bg-neon-green/10 transition-colors text-[14px]"
            >
              <span className="font-semibold">{t(language, 'create_invite_link')}</span>
              <span className={inviteCopied ? 'text-neon-green' : 'text-neon-green/80'}>
                {inviteCopied ? <Check size={16} /> : <Link2 size={16} />}
              </span>
            </button>

            <button
              type="button"
              onClick={handleCopyId}
              className="w-full flex items-center justify-between px-4 py-2.5 text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors text-[14px]"
            >
              <span className="font-semibold">{copied ? t(language, 'copied') : t(language, 'copy_id')}</span>
              <span className={copied ? 'text-neon-green' : 'text-white/60'}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </span>
            </button>

            <div className="my-2 mx-4 h-px bg-white/10" />

            <button
              type="button"
              onClick={handleLeaveServer}
              disabled={isOwner}
              className={
                isOwner
                  ? 'w-full flex items-center justify-between px-4 py-2.5 text-white/30 cursor-not-allowed text-[14px]'
                  : 'w-full flex items-center justify-between px-4 py-2.5 text-neon-pink hover:bg-neon-pink/10 transition-colors text-[14px]'
              }
              title={isOwner ? (language === 'es' ? 'El propietario no puede abandonar este servidor' : 'Owners cannot leave this server') : undefined}
            >
              <span className="font-semibold">{t(language, 'leave_server_btn')}</span>
              <span className={isOwner ? 'text-white/25' : 'text-neon-pink'}>
                <LogOut size={16} />
              </span>
            </button>

            {isOwner ? (
              <button
                type="button"
                onClick={handleDelete}
                className="w-full flex items-center justify-between px-4 py-2.5 text-red-400 hover:bg-red-500/10 transition-colors text-[14px]"
              >
                <span className="font-semibold">{t(language, 'delete_server_btn')}</span>
                <span className="text-red-400">
                  <Trash2 size={16} />
                </span>
              </button>
            ) : null}
          </div>
        </div>
      </ModalBase>

      <ModalBase
        open={inviteBuilderMounted}
        onClose={closeInviteBuilder}
        ariaLabelledBy="invite-builder-modal-title"
        ariaDescribedBy="invite-builder-modal-description"
        rootClassName="z-[550]"
        overlayClassName={[
          'mac-glass-backdrop transition-opacity duration-300',
          inviteBuilderVisible ? 'opacity-100 bg-black/45 backdrop-blur-md' : 'opacity-0 pointer-events-none bg-black/0',
        ].join(' ')}
        panelClassName={[
          'w-full max-w-[560px] rounded-3xl border border-white/10 bg-[#0B0C10]/88 glass-ruby-surface backdrop-blur-2xl shadow-[0_24px_80px_rgba(0,0,0,0.55)] overflow-hidden',
          inviteBuilderVisible ? 'mac-scale-enter' : 'mac-scale-exit',
        ].join(' ')}
      >
        <div className="px-6 py-4 border-b border-white/10 bg-white/[0.02] flex items-start justify-between gap-4">
          <div>
            <h3 id="invite-builder-modal-title" className="text-white text-xl font-black tracking-tight">
              {t(language, 'create_invite_link')}
            </h3>
            <p id="invite-builder-modal-description" className="text-xs text-white/55 mt-1">
              Configura duracion, limite de usos y copia tu enlace en un click.
            </p>
          </div>
          <button
            type="button"
            onClick={closeInviteBuilder}
            className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/10 text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors flex items-center justify-center"
            title="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-visible">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3.5">
              <div className="text-[10px] font-black uppercase tracking-widest text-white/55 mb-2">
                {t(language, 'invite_expires')}
              </div>
              <FlowGlassSelect
                value={quickInviteExpiry}
                options={expiryOptions}
                onChange={setQuickInviteExpiry}
                ariaLabel={t(language, 'invite_expires')}
              />
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/25 p-3.5">
              <div className="text-[10px] font-black uppercase tracking-widest text-white/55 mb-2">
                {t(language, 'invite_max_uses')}
              </div>
              <FlowGlassSelect
                value={quickInviteMaxUses}
                options={maxUsesOptions}
                onChange={setQuickInviteMaxUses}
                ariaLabel={t(language, 'invite_max_uses')}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCreateInviteLink(false)}
              disabled={inviteBusy}
              className="px-4 py-2.5 rounded-xl bg-neon-green/20 border border-neon-green/45 text-neon-green text-xs font-black uppercase tracking-widest hover:bg-neon-green/28 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t(language, 'create_invite')}
            </button>
            <button
              type="button"
              onClick={() => void handleCreateInviteLink(true)}
              disabled={inviteBusy}
              className={[
                'px-4 py-2.5 rounded-xl border text-xs font-black uppercase tracking-widest transition-all',
                inviteBusy
                  ? 'bg-white/[0.02] border-white/10 text-white/35 cursor-not-allowed'
                  : 'bg-white/[0.05] border-white/20 text-white hover:bg-white/[0.09]',
              ].join(' ')}
            >
              {inviteCopied ? t(language, 'invite_link_copied') : 'Crear y copiar'}
            </button>
            <button
              type="button"
              onClick={() => void handleCopyInviteLink()}
              disabled={!lastInviteLink}
              className={[
                'px-4 py-2.5 rounded-xl border text-xs font-black uppercase tracking-widest transition-all',
                lastInviteLink
                  ? 'bg-white/[0.05] border-white/20 text-white hover:bg-white/[0.09]'
                  : 'bg-white/[0.02] border-white/10 text-white/35 cursor-not-allowed',
              ].join(' ')}
            >
              Copiar enlace
            </button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-white/45 mb-2">
              Enlace generado
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={lastInviteLink || ''}
                placeholder="Crea una invitacion para ver el enlace aqui"
                className="w-full text-[12px] font-mono text-white/80 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 outline-none"
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                onClick={() => void handleCopyInviteLink()}
                disabled={!lastInviteLink}
                className={[
                  'h-9 px-3 rounded-lg border text-xs font-black uppercase tracking-widest transition-all inline-flex items-center justify-center',
                  lastInviteLink
                    ? 'bg-white/[0.06] border-white/20 text-white hover:bg-white/[0.12]'
                    : 'bg-white/[0.02] border-white/10 text-white/35 cursor-not-allowed',
                ].join(' ')}
                title="Copiar enlace"
              >
                {inviteCopied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        </div>
      </ModalBase>
    </>
  );
};
