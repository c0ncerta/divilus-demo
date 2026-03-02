import React, { useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import { CREW_CUSTOM_EMBLEM_ID, getCrewPreset, readCrewIdentity, type CrewIdentity } from '../../lib/crew-emblems';

type CrewBadgeProps = {
  userId: string;
  className?: string;
  size?: 'xs' | 'sm' | 'md';
  showName?: boolean;
};

const sizeClassByKey: Record<NonNullable<CrewBadgeProps['size']>, string> = {
  xs: 'text-[9px] px-1.5 py-0.5 gap-1',
  sm: 'text-[10px] px-2 py-0.5 gap-1',
  md: 'text-[11px] px-2.5 py-1 gap-1.5',
};

const auraClassByKey: Record<CrewIdentity['aura'], string> = {
  none: '',
  pulse: 'crew-badge-aura-pulse',
  scan: 'crew-badge-aura-scan',
  neon: 'crew-badge-aura-neon',
};

export const CrewBadge = ({ userId, className, size = 'sm', showName = false }: CrewBadgeProps) => {
  const [profile, setProfile] = useState<CrewIdentity | null>(null);

  useEffect(() => {
    if (!userId) return;
    const sync = () => setProfile(readCrewIdentity(userId));
    const onCrewUpdate = (event: Event) => {
      const payload = (event as CustomEvent<{ userId?: string }>).detail;
      if (payload?.userId && payload.userId !== userId) return;
      sync();
    };
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener('diavlocord:crew-updated', onCrewUpdate as EventListener);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('diavlocord:crew-updated', onCrewUpdate as EventListener);
    };
  }, [userId]);

  const preset = useMemo(() => getCrewPreset(profile?.emblemId), [profile?.emblemId]);
  const useCustomEmblem = profile?.emblemId === CREW_CUSTOM_EMBLEM_ID && !!profile?.customEmblemUrl;
  if (!profile?.enabled || (!useCustomEmblem && !preset)) return null;
  const accentColor = useCustomEmblem ? profile.color : preset.accent;
  const glowColor = useCustomEmblem ? `${profile.color}66` : preset.glow;

  return (
    <span
      className={cn(
        'crew-badge-shell inline-flex items-center rounded-full border font-black uppercase tracking-widest',
        sizeClassByKey[size],
        auraClassByKey[profile.aura],
        className
      )}
      style={{
        color: profile.color,
        borderColor: `${profile.color}77`,
        background: `linear-gradient(120deg, ${profile.color}1F 0%, rgba(255,255,255,0.02) 50%, ${accentColor}14 100%)`,
        boxShadow: `0 0 14px ${glowColor}`,
      }}
      title={showName ? `${profile.crewName} // ${profile.crewTag}` : profile.crewName}
    >
      {useCustomEmblem ? (
        <span className="crew-badge-glyph crew-badge-glyph-media">
          <img
            src={profile.customEmblemUrl}
            alt={`${profile.crewTag} emblem`}
            className="crew-badge-glyph-image"
            loading="lazy"
            decoding="async"
          />
        </span>
      ) : (
        <span className="crew-badge-glyph">{preset.glyph}</span>
      )}
      <span>{profile.crewTag}</span>
      {showName ? <span className="text-white/75 normal-case tracking-normal font-semibold">{profile.crewName}</span> : null}
    </span>
  );
};
