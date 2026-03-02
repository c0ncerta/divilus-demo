import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../lib/store';
import { Settings, LogOut } from 'lucide-react';
import { t } from '../../lib/i18n';
import { NitroEmblems } from '../ui/NitroEmblems';
import { CrewBadge } from '../ui/CrewBadge';
import { ModalBase } from '../ui/ModalBase';

interface ProfilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSettings: () => void;
}

export const ProfilePreviewModal = ({ isOpen, onClose, onSettings }: ProfilePreviewModalProps) => {
  const { currentUser, language } = useStore();
  const [nitroActive, setNitroActive] = useState(false);
  const [mounted, setMounted] = useState(isOpen);
  const [visible, setVisible] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    try {
      const rawExpiry = localStorage.getItem('diavlocord-nitro-expiry');
      if (!rawExpiry) {
        setNitroActive(false);
        return;
      }
      const expiryMs = Number(rawExpiry) || new Date(rawExpiry).getTime();
      setNitroActive(!Number.isNaN(expiryMs) && expiryMs > Date.now());
    } catch (e) {
      setNitroActive(false);
    }
  }, []);

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

  if (!mounted) return null;

  const handleSettings = () => {
    onSettings();
    onClose();
  };

  return (
    <ModalBase
      open={mounted}
      onClose={onClose}
      ariaLabelledBy="profile-preview-modal-title"
      ariaDescribedBy="profile-preview-modal-description"
      rootClassName="z-[650]"
      overlayClassName={[
        'mac-glass-backdrop transition-opacity duration-300',
        visible ? 'opacity-100 bg-black/10' : 'opacity-0 pointer-events-none bg-transparent',
      ].join(' ')}
      containerClassName="pointer-events-none p-0"
      panelClassName={[
        'pointer-events-auto fixed bottom-24 left-[96px] w-80 origin-bottom-left',
        visible ? 'mac-genie-enter' : 'mac-genie-exit',
      ].join(' ')}
      initialFocusRef={settingsButtonRef}
    >
        <div className="bg-[#0B0C10]/88 glass-ruby-surface rounded-2xl overflow-hidden shadow-2xl border border-white/10">
          <h2 id="profile-preview-modal-title" className="sr-only">
            Perfil de usuario
          </h2>
          <p id="profile-preview-modal-description" className="sr-only">
            Vista previa del perfil con acciones de editar perfil y cerrar sesion.
          </p>
          {/* Banner */}
          <div
            className="h-24 w-full relative overflow-hidden"
            style={{
              backgroundColor: currentUser.banner ? undefined : (currentUser.bannerColor || '#7A1027'),
            }}
          >
            {currentUser.banner ? (
              <img
                src={currentUser.banner}
                alt={`${currentUser.username} banner`}
                className="absolute inset-0 w-full h-full object-cover"
                loading="eager"
                decoding="sync"
                draggable={false}
              />
            ) : null}
            {nitroActive ? (
              <div className="absolute top-2 right-2">
                <NitroEmblems size={10} compact />
              </div>
            ) : null}
          </div>

          {/* Content */}
          <div className="px-6 pb-6 relative -mt-8">
            {/* Avatar */}
            <div className="mb-4">
              <div className="relative w-20 h-20">
                <div className="w-20 h-20 rounded-2xl border-4 border-[#0B0C10] bg-[#7A1027] overflow-hidden shadow-lg">
                  {currentUser.avatar ? (
                    <img src={currentUser.avatar} alt={currentUser.username} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl font-bold text-white">
                      {currentUser.username[0]}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Username & Discriminator */}
            <div className="mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-xl font-semibold text-white leading-none">
                  {currentUser.username}
                </div>
              </div>
              <div className="text-xs text-white/50 mt-1">#{currentUser.discriminator}</div>
              {nitroActive ? (
                <div className="mt-2">
                  <NitroEmblems size={12} />
                </div>
              ) : null}
              <div className="mt-2">
                <CrewBadge userId={currentUser.id} size="sm" showName />
              </div>
            </div>

            {/* Bio */}
            {currentUser.bio && (
              <div className="mb-5 p-3 rounded-lg bg-white/[0.03] border border-white/10">
                <div className="text-xs text-white/70 italic leading-relaxed">
                  "{currentUser.bio}"
                </div>
              </div>
            )}

            {/* Buttons */}
            <div className="space-y-2 pt-3 border-t border-white/10">
              <button
                type="button"
                ref={settingsButtonRef}
                onClick={handleSettings}
                className="w-full flex items-center gap-2 px-4 py-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.06] text-white/70 hover:text-white transition-colors text-sm font-semibold active:scale-95 transform"
              >
                <Settings size={16} />
                {t(language, 'edit_profile')}
              </button>
              <button
                type="button"
                onClick={() => {
                  const logout = useStore.getState().logout;
                  logout();
                  onClose();
                  window.location.reload();
                }}
                className="w-full flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 hover:bg-red-500/15 text-red-400 hover:text-red-300 transition-colors text-sm font-semibold active:scale-95 transform"
              >
                <LogOut size={16} />
                {t(language, 'log_out')}
              </button>
            </div>
          </div>
        </div>
    </ModalBase>
  );
};
