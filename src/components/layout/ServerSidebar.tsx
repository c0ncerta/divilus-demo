import React, { useState, useEffect } from 'react';
import { useStore } from '../../lib/store';
import { Plus, Compass, Download } from 'lucide-react';
import { cn } from '../../lib/utils';
import { CreateServerModal } from '../modals/CreateServerModal';
import { MediaGenerationModal } from '../modals/MediaGenerationModal';
import Image from 'next/image';
import { t } from '../../lib/i18n';

export const ServerSidebar = () => {
  const { servers, activeServerId, setActiveServer, currentUser, language } = useStore();
  const createServer = useStore(state => state.createServer);
  const joinServerByInvite = useStore(state => state.joinServerByInvite);
  const [modalOpen, setModalOpen] = useState(false);
  const [mediaModalOpen, setMediaModalOpen] = useState(false);
  const [joinFeedback, setJoinFeedback] = useState('');
  const [focusedServerNavId, setFocusedServerNavId] = useState<string>('home');
  const serverButtonRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const homeLabel = language === 'es' ? 'Inicio' : 'Home';

  const joinErrorMessageByReason = (reason?: string) => {
    if (reason === 'expired') return t(language, 'invite_expired');
    if (reason === 'maxed') return t(language, 'invite_maxed');
    if (reason === 'revoked') return t(language, 'invite_revoked');
    if (reason === 'banned') return t(language, 'invite_banned');
    return t(language, 'invite_not_found');
  };

  // Ensure active server remains valid for the current user.
  useEffect(() => {
    const filteredServers = servers.filter((server) =>
      server.members.some((member) => member.userId === currentUser.id)
    );
    
    // Keep active server/channel consistent after membership updates.
    if (activeServerId) {
      const isValidServer = filteredServers.some((server) => server.id === activeServerId);
      if (!isValidServer) {
        const fallbackServerId = filteredServers[0]?.id || null;
        setActiveServer(fallbackServerId);
      }
    }
  }, [servers, currentUser.id, activeServerId, setActiveServer]);

  useEffect(() => {
    if (!joinFeedback) return;
    const id = setTimeout(() => setJoinFeedback(''), 1800);
    return () => clearTimeout(id);
  }, [joinFeedback]);

  // Filter servers where the current user is a member
  const userServers = servers.filter(server => 
    server.members.some(member => member.userId === currentUser.id)
  );

  const serverNavIds = ['home', ...userServers.map((server) => server.id)];

  const focusServerNavByIndex = (index: number) => {
    const bounded = Math.max(0, Math.min(serverNavIds.length - 1, index));
    const id = serverNavIds[bounded];
    if (!id) return;
    serverButtonRefs.current[id]?.focus();
    setFocusedServerNavId(id);
  };

  const handleServerNavKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    const currentIndex = serverNavIds.indexOf(id);
    if (currentIndex < 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusServerNavByIndex(currentIndex + 1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusServerNavByIndex(currentIndex - 1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      focusServerNavByIndex(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      focusServerNavByIndex(serverNavIds.length - 1);
    }
  };

  return (
    <div className="w-[84px] max-sm:w-[74px] bg-[#050506] glass-ruby-shell flex flex-col items-center py-6 space-y-4 h-full border-r border-white/[0.03] z-[100]">
      {/* Home / DMs - Logo */}
      <button 
        ref={(node) => {
          serverButtonRefs.current.home = node;
        }}
        onClick={() => setActiveServer(null)}
        onFocus={() => setFocusedServerNavId('home')}
        onKeyDown={(event) => handleServerNavKeyDown(event, 'home')}
        aria-current={!activeServerId ? 'page' : undefined}
        aria-label={homeLabel}
        tabIndex={focusedServerNavId === 'home' ? 0 : -1}
        className={cn(
          "group relative flex items-center justify-center w-14 h-14 transition-all duration-500 overflow-hidden",
          !activeServerId 
            ? "rounded-2xl bg-transparent text-white/90 shadow-none" 
            : "rounded-[24px] bg-white/[0.03] text-[#B5BAC1] hover:rounded-2xl hover:bg-neon-blue hover:text-black hover:shadow-[0_0_25px_rgba(194,24,60,0.4)]"
        )}
        title={homeLabel}
      >
        <div className="relative w-12 h-12 rounded-[16px] overflow-hidden">
          <Image 
            src="/logo.png" 
            alt="DiavloCord Logo" 
            fill
            className="object-contain p-1 transition-transform duration-500 group-hover:scale-110"
            priority
          />
        </div>
        {!activeServerId && (
          <div className="absolute -left-3 w-1.5 h-10 bg-white rounded-r-full shadow-[0_0_15px_white]" />
        )}
      </button>

      <div className="w-10 h-px bg-white/[0.05] mx-auto my-2" />

      {/* Servers */}
      <div className="flex-1 flex flex-col items-center space-y-4 overflow-y-auto no-scrollbar w-full">
        {userServers.map((server) => (
          <button
            key={server.id}
            ref={(node) => {
              serverButtonRefs.current[server.id] = node;
            }}
            onClick={() => setActiveServer(server.id)}
            onFocus={() => setFocusedServerNavId(server.id)}
            onKeyDown={(event) => handleServerNavKeyDown(event, server.id)}
            aria-current={activeServerId === server.id ? 'page' : undefined}
            aria-label={`Servidor ${server.name}`}
            tabIndex={focusedServerNavId === server.id ? 0 : -1}
            className="group relative flex items-center justify-center w-14 h-14 transition-all duration-500"
          >
            {activeServerId === server.id && (
              <div
                className="absolute -left-0 w-1.5 h-10 rounded-r-full"
                style={{
                  backgroundColor: server.accentColor || '#C2183C',
                  boxShadow: `0 0 15px ${server.accentColor || '#C2183C'}`,
                }}
              />
            )}
            <div className={cn(
              "w-14 h-14 transition-all duration-500 overflow-hidden flex items-center justify-center",
              activeServerId === server.id 
                ? "rounded-2xl shadow-[0_0_30px_rgba(194,24,60,0.15)] ring-2 ring-neon-blue/30" 
                : "rounded-[24px] bg-white/[0.03] group-hover:rounded-2xl group-hover:shadow-[0_0_20px_rgba(255,255,255,0.05)] group-hover:ring-1 group-hover:ring-white/20"
            )}
            style={
              activeServerId === server.id && server.accentColor
                ? {
                    boxShadow: `0 0 30px ${server.accentColor}33`,
                    outline: `2px solid ${server.accentColor}55`,
                    outlineOffset: '-2px',
                  }
                : undefined
            }>
              {server.icon ? (
                <img src={server.icon} alt={server.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" title={server.name} />
              ) : (
                <span className="text-xs font-black uppercase tracking-tighter text-white opacity-60 group-hover:opacity-100">{server.name.substring(0, 2)}</span>
              )}
            </div>
          </button>
        ))}

        {/* Actions */}
        <button onClick={() => setModalOpen(true)} className="group flex items-center justify-center w-14 h-14 rounded-[24px] hover:rounded-2xl transition-all duration-500 bg-white/[0.02] border border-dashed border-white/10 hover:border-neon-green hover:bg-neon-green/5 text-[#4E5058] hover:text-neon-green">
          <Plus size={24} className="group-hover:rotate-90 transition-transform duration-500" />
        </button>
        
        <button onClick={() => setModalOpen(true)} className="group flex items-center justify-center w-14 h-14 rounded-[24px] hover:rounded-2xl transition-all duration-500 bg-white/[0.02] border border-white/5 hover:border-neon-purple hover:bg-neon-purple/5 text-[#4E5058] hover:text-neon-purple">
          <Compass size={24} className="group-hover:scale-110 transition-transform duration-500" />
        </button>
      </div>

      <CreateServerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={(input) => createServer({ name: input.name, icon: input.icon })}
        onJoin={(invite) => {
          const result = joinServerByInvite(invite);
          if (!result.ok) {
            setJoinFeedback(joinErrorMessageByReason(result.reason));
            return false;
          }
          setJoinFeedback('');
          return true;
        }}
      />

      <MediaGenerationModal
        open={mediaModalOpen}
        onClose={() => setMediaModalOpen(false)}
      />

      {joinFeedback ? (
        <div className="fixed bottom-8 left-[96px] max-sm:left-4 max-sm:right-4 z-[380] px-4 py-2 rounded-xl border border-neon-pink/35 bg-[#0B0C10]/92 text-neon-pink font-black uppercase tracking-widest text-[10px] shadow-[0_0_24px_rgba(194,24,60,0.2)]">
          {joinFeedback}
        </div>
      ) : null}
      
      <button
        onClick={() => setMediaModalOpen(true)}
        title="Generador de imagen y video"
        className="group flex items-center justify-center w-14 h-14 rounded-[24px] hover:rounded-2xl transition-all duration-500 bg-white/[0.02] border border-white/5 hover:border-white/20 text-[#4E5058] hover:text-white mb-2"
      >
        <Download size={20} />
      </button>
    </div>
  );
};
