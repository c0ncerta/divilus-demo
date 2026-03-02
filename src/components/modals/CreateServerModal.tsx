import React, { useEffect, useRef, useState } from 'react';
import { X, Link } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useStore } from '../../lib/store';
import { t } from '../../lib/i18n';
import { ModalBase } from '../ui/ModalBase';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; icon?: string }) => void;
  onJoin: (invite: string) => boolean;
};

export const CreateServerModal = ({ open, onClose, onCreate, onJoin }: Props) => {
  const { language } = useStore();
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [joinError, setJoinError] = useState('');
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [open, tab]);

  useEffect(() => {
    if (!open) {
      setJoinError('');
      return;
    }
    if (tab !== 'join') {
      setJoinError('');
    }
  }, [open, tab]);

  useEffect(() => {
    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (open) {
      setMounted(true);
      rafId = requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
      timeoutId = setTimeout(() => setMounted(false), 240);
    }

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [open]);

  if (!mounted) return null;

  const canCreate = name.trim().length >= 2;
  const canJoin = invite.trim().length >= 2;
  const titleId = 'create-server-modal-title';
  const descriptionId = 'create-server-modal-description';

  return (
    <ModalBase
      open={mounted}
      onClose={onClose}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      rootClassName="z-[700]"
      overlayClassName={cn(
        'transition-opacity duration-250',
        visible ? 'opacity-100' : 'opacity-0'
      )}
      panelClassName={cn(
        'relative w-full max-w-[520px] bg-[#0B0C10]/80 glass-ruby-surface backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        visible ? 'opacity-100 scale-100 translate-y-0 blur-0' : 'opacity-0 scale-[0.95] translate-y-3 blur-[2px] pointer-events-none'
      )}
      initialFocusRef={inputRef}
    >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="px-3 py-1 rounded-full bg-white/[0.04] border border-white/10 text-[10px] font-semibold uppercase tracking-widest text-white/60">{t(language, 'server_manager')}</div>
            <h3 id={titleId} className="text-2xl font-semibold text-white">{t(language, 'create_or_join')}</h3>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"><X size={18} /></button>
        </div>
        <p id={descriptionId} className="sr-only">
          Crea un servidor nuevo o unete con un enlace de invitacion.
        </p>

        <div className="mb-6 flex gap-2">
          <button onClick={() => setTab('create')} className={cn("px-4 py-2 rounded-lg font-semibold transition-colors", tab === 'create' ? 'bg-[#7A1027] text-white' : 'bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.06]')}>{t(language, 'create')}</button>
          <button onClick={() => setTab('join')} className={cn("px-4 py-2 rounded-lg font-semibold transition-colors", tab === 'join' ? 'bg-neon-green text-black' : 'bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.06]')}>{t(language, 'join')}</button>
        </div>

        {tab === 'create' ? (
          <div>
            <label htmlFor="create-server-name" className="text-xs font-semibold text-white/60 uppercase tracking-widest">{t(language, 'server_name')}</label>
            <input id="create-server-name" ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="My Cool Server" className="w-full mt-2 bg-white/[0.04] border border-white/10 rounded-xl py-3 px-4 outline-none text-white placeholder-white/30 focus:border-[#7A1027]/60 focus:bg-white/[0.06] transition-colors" />

            <div className="mt-6 flex justify-end">
              <button disabled={!canCreate} onClick={() => { onCreate({ name: name.trim() }); setName(''); onClose(); }} className={cn('px-6 py-3 rounded-xl font-semibold transition-colors', canCreate ? 'bg-[#7A1027] text-white hover:bg-[#5B0C1C]' : 'bg-white/[0.04] text-white/30 cursor-not-allowed')}>{t(language, 'create')}</button>
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="create-server-invite" className="text-xs font-semibold text-white/60 uppercase tracking-widest">{t(language, 'invite_code')}</label>
            <div className="mt-2 flex gap-2">
              <input
                id="create-server-invite"
                ref={inputRef}
                value={invite}
                onChange={(e) => {
                  setInvite(e.target.value);
                  if (joinError) setJoinError('');
                }}
                placeholder={t(language, 'invite_input_placeholder')}
                aria-describedby={joinError ? 'create-server-invite-error' : undefined}
                className={cn(
                  "flex-1 bg-white/[0.04] border rounded-xl py-3 px-4 outline-none text-white placeholder-white/30 focus:border-[#7A1027]/60 focus:bg-white/[0.06] transition-colors",
                  joinError ? "border-neon-pink/50" : "border-white/10"
                )}
              />
              <button
                onClick={() => {
                  if (!canJoin) return;
                  const ok = onJoin(invite.trim());
                  if (ok) {
                    setInvite('');
                    setJoinError('');
                    onClose();
                    return;
                  }
                  setJoinError(t(language, 'invite_not_found'));
                }}
                disabled={!canJoin}
                className={cn('px-4 py-3 rounded-xl font-semibold transition-colors', canJoin ? 'bg-neon-green text-black hover:bg-neon-green/90' : 'bg-white/[0.04] text-white/30 cursor-not-allowed')}
              >
                <Link size={16} />
              </button>
            </div>
            {joinError ? (
              <div id="create-server-invite-error" className="mt-3 text-[11px] font-black uppercase tracking-widest text-neon-pink" role="alert" aria-live="assertive">
                {joinError}
              </div>
            ) : null}
          </div>
        )}
    </ModalBase>
  );
};
