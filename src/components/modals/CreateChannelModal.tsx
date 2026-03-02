import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Hash, Volume2, Sparkles, Terminal } from 'lucide-react';
import { ChannelType } from '../../lib/types';
import { cn } from '../../lib/utils';
import { useStore } from '../../lib/store';
import { t } from '../../lib/i18n';
import { ModalBase } from '../ui/ModalBase';

type Props = {
  open: boolean;
  serverName: string;
  categoryName: string;
  onClose: () => void;
  onCreate: (input: { name: string; type: ChannelType; topic?: string }) => void;
};

export const CreateChannelModal = ({ open, serverName, categoryName, onClose, onCreate }: Props) => {
  const { language } = useStore();
  const [type, setType] = useState<ChannelType>('text');
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [open]);

  const canSubmit = name.trim().length >= 2;
  const titleId = 'create-channel-modal-title';
  const descriptionId = 'create-channel-modal-description';

  const onSubmit = () => {
    const clean = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
    if (clean.length < 2) return;
    onCreate({ name: clean, type, topic: topic.trim() ? topic.trim() : undefined });
    setName('');
    setTopic('');
    setType('text');
    onClose();
  };

  if (!open) return null;

  return (
    <ModalBase
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      rootClassName="z-[300]"
      overlayClassName="animate-in fade-in duration-500"
      panelClassName="relative w-full max-w-[500px] max-h-[calc(100vh-2rem)] overflow-y-auto bg-[#0B0C10]/80 glass-ruby-surface backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl animate-in zoom-in-95 fade-in duration-300"
      initialFocusRef={inputRef}
    >
        {/* Decorative Top Gradient */}
        <div className="h-px w-full bg-gradient-to-r from-[#7A1027]/60 via-neon-purple/40 to-neon-pink/30" />
        
        <div className="p-10">
          <div className="flex items-start justify-between mb-10">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/10 text-white/50 text-[9px] font-semibold uppercase tracking-widest mb-4">
                {t(language, 'system_registry')}
              </div>
              <h2 id={titleId} className="text-white text-3xl font-semibold tracking-tight leading-none">{t(language, 'new_node')} <span className="text-[#7A1027]">{t(language, 'node')}</span></h2>
              <p id={descriptionId} className="text-white/40 text-xs font-semibold uppercase tracking-[0.2em] mt-3">{serverName} // {categoryName}</p>
            </div>
            <button
              onClick={onClose}
              className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="space-y-8">
            {/* Type Selector */}
            <div className="grid grid-cols-2 gap-3 p-1 bg-white/[0.03] border border-white/10 rounded-xl">
              <button
                onClick={() => setType('text')}
                className={cn(
                  "flex items-center justify-center gap-3 py-4 rounded-lg transition-all duration-300 font-semibold uppercase tracking-widest text-[10px]",
                  type === 'text' 
                    ? "bg-[#7A1027] text-white shadow-lg" 
                    : "text-white/50 hover:text-white hover:bg-white/[0.04]"
                )}
              >
                <Terminal size={16} />
                {t(language, 'data_stream')}
              </button>
              <button
                onClick={() => setType('voice')}
                className={cn(
                  "flex items-center justify-center gap-3 py-4 rounded-lg transition-all duration-300 font-semibold uppercase tracking-widest text-[10px]",
                  type === 'voice' 
                    ? "bg-[#7A1027] text-white shadow-lg" 
                    : "text-white/50 hover:text-white hover:bg-white/[0.04]"
                )}
              >
                <Volume2 size={16} />
                {t(language, 'voice_link')}
              </button>
            </div>

            {/* Input Field */}
            <div className="space-y-3">
              <label htmlFor="create-channel-name" className="text-[9px] font-semibold text-white/50 uppercase tracking-[0.3em] ml-2">{t(language, 'identifier')}</label>
              <div className="relative group">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-[#7A1027] transition-colors">
                  {type === 'voice' ? <Volume2 size={18} /> : <Hash size={18} />}
                </div>
                <input
                  id="create-channel-name"
                  ref={inputRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="enter-identifier..."
                  className="w-full bg-white/[0.04] border border-white/10 text-white rounded-xl py-5 pl-14 pr-6 outline-none placeholder-white/30 font-semibold tracking-tight focus:border-[#7A1027]/60 focus:bg-white/[0.06] transition-colors"
                />
              </div>
            </div>

            {/* Topic Field */}
            <div className="space-y-3">
              <label htmlFor="create-channel-topic" className="text-[9px] font-semibold text-white/50 uppercase tracking-[0.3em] ml-2">{t(language, 'description_optional')}</label>
              <input
                id="create-channel-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="uplink-purpose..."
                className="w-full bg-white/[0.04] border border-white/10 text-white rounded-xl py-5 px-6 outline-none placeholder-white/30 font-semibold tracking-tight focus:border-[#7A1027]/60 focus:bg-white/[0.06] transition-colors"
              />
            </div>
          </div>

          <div className="mt-12 flex items-center justify-between">
            <div className="text-[9px] font-semibold text-white/40 uppercase tracking-[0.3em]">
              {t(language, 'node_deployment')}
            </div>
            <button
              disabled={!canSubmit}
              onClick={onSubmit}
              className={cn(
                "px-10 py-4 rounded-xl font-semibold uppercase tracking-widest transition-colors active:scale-95 transform",
                canSubmit 
                  ? "bg-[#7A1027] text-white hover:bg-[#5B0C1C]" 
                  : "bg-white/[0.04] border border-white/10 text-white/30 cursor-not-allowed"
              )}
            >
              {t(language, 'initialize_node')}
            </button>
          </div>
        </div>
    </ModalBase>
  );
};
