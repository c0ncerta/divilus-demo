import React, { useEffect, useMemo, useState } from 'react';
import { Hash, Volume2, X } from 'lucide-react';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import type { Permission } from '../../lib/types';
import { ModalBase } from '../ui/ModalBase';

type Props = {
  open: boolean;
  serverId: string | null;
  channelId: string | null;
  onClose: () => void;
};

export const ChannelSettingsModal = ({ open, serverId, channelId, onClose }: Props) => {
  const { servers, updateChannel, updateChannelRolePermission } = useStore();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [userLimit, setUserLimit] = useState(0);

  const channel = useMemo(() => {
    if (!serverId || !channelId) return null;
    const server = servers.find((entry) => entry.id === serverId);
    if (!server) return null;
    return server.categories.flatMap((category) => category.channels).find((entry) => entry.id === channelId) || null;
  }, [servers, serverId, channelId]);
  const serverRoles = useMemo(() => {
    if (!serverId) return [];
    const server = servers.find((entry) => entry.id === serverId);
    if (!server) return [];
    return [...server.roles].sort((a, b) => a.position - b.position);
  }, [servers, serverId]);

  useEffect(() => {
    if (!open || !channel) return;
    setName(channel.name || '');
    setTopic(channel.topic || '');
    setUserLimit(typeof channel.userLimit === 'number' && channel.userLimit > 0 ? channel.userLimit : 0);
  }, [open, channel]);

  if (!open || !channel || !serverId || !channelId) return null;

  const normalizedName = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
  const canSave = normalizedName.length >= 2;
  const titleId = 'channel-settings-modal-title';
  const descriptionId = 'channel-settings-modal-description';

  const handleSave = () => {
    if (!canSave) return;
    updateChannel(serverId, channelId, {
      name: normalizedName,
      topic: topic.trim(),
      ...(channel.type === 'voice' ? { userLimit } : {}),
    });
    onClose();
  };

  const hasRoleChannelPermission = (roleId: string, permission: Permission) => {
    if (!channel) return false;
    const overwrite = channel.permissionOverwrites?.find((entry) => entry.type === 'role' && entry.id === roleId);
    if (overwrite?.deny?.includes(permission)) return false;
    if (overwrite?.allow?.includes(permission)) return true;
    const role = serverRoles.find((entry) => entry.id === roleId);
    if (!role) return false;
    return role.permissions.includes('ADMINISTRATOR') || role.permissions.includes(permission);
  };

  return (
    <ModalBase
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      rootClassName="z-[340]"
      panelClassName="relative w-full max-w-[560px] max-h-[calc(100vh-2rem)] rounded-2xl bg-[#0B0C10]/88 glass-ruby-surface border border-white/10 shadow-2xl overflow-hidden"
    >
        <div className="h-px w-full bg-gradient-to-r from-[#7A1027]/60 via-neon-purple/40 to-neon-pink/30" />
        <div className="p-7 overflow-y-auto max-h-[calc(100vh-2rem)]">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/10 text-white/50 text-[9px] font-semibold uppercase tracking-widest mb-3">
                Ajustes del canal
              </div>
              <h2 id={titleId} className="text-white text-2xl font-semibold tracking-tight flex items-center gap-2">
                {channel.type === 'voice' ? <Volume2 size={18} className="text-neon-blue" /> : <Hash size={18} className="text-neon-blue" />}
                {channel.name}
              </h2>
              <p id={descriptionId} className="sr-only">Edita nombre, descripcion y permisos del canal.</p>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.08] transition-all"
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-5">
            <div>
              <label htmlFor="channel-settings-name" className="text-[10px] font-black text-white/55 uppercase tracking-[0.2em] mb-1.5 block">Nombre del canal</label>
              <input
                id="channel-settings-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-xl bg-black/25 border border-white/10 px-4 py-3 text-white outline-none focus:border-neon-blue/40 transition-all"
                placeholder="nombre-del-canal"
              />
            </div>

            <div>
              <label htmlFor="channel-settings-topic" className="text-[10px] font-black text-white/55 uppercase tracking-[0.2em] mb-1.5 block">Descripcion</label>
              <input
                id="channel-settings-topic"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                className="w-full rounded-xl bg-black/25 border border-white/10 px-4 py-3 text-white outline-none focus:border-neon-blue/40 transition-all"
                placeholder={channel.type === 'voice' ? 'Sala de voz principal' : 'Descripcion del canal'}
              />
            </div>

            {channel.type === 'voice' ? (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[10px] font-black text-white/55 uppercase tracking-[0.2em]">Limite de usuarios</div>
                  <div className="text-xs font-black text-white">{userLimit > 0 ? userLimit : 'INF'}</div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={99}
                  value={userLimit}
                  onChange={(event) => setUserLimit(Number(event.target.value))}
                  className="w-full accent-neon-blue"
                />
                <div className="mt-2 flex items-center gap-2">
                  {[0, 2, 5, 10, 25, 50].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setUserLimit(preset)}
                      className={cn(
                        "px-2.5 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-widest transition-all",
                        userLimit === preset
                          ? "bg-neon-blue/15 border-neon-blue/45 text-neon-blue"
                          : "bg-white/[0.03] border-white/10 text-[#B5BAC1] hover:bg-white/[0.06]"
                      )}
                    >
                      {preset === 0 ? 'INF' : preset}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {channel.type === 'voice' && serverRoles.length > 0 ? (
              <div>
                <div className="text-[10px] font-black text-white/55 uppercase tracking-[0.2em] mb-2">Quien puede unirse</div>
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                  {serverRoles.map((role) => {
                    const allowed = hasRoleChannelPermission(role.id, 'VIEW_CHANNEL');
                    return (
                      <button
                        key={role.id}
                        onClick={() => updateChannelRolePermission(serverId, channelId, role.id, 'VIEW_CHANNEL', !allowed)}
                        className={cn(
                          "w-full px-3 py-2 rounded-xl border text-left transition-all flex items-center justify-between gap-3",
                          allowed
                            ? "border-neon-green/40 bg-neon-green/10"
                            : "border-white/10 bg-black/20 hover:bg-white/[0.05]"
                        )}
                      >
                        <span className="text-sm font-black truncate" style={{ color: role.color || '#DBDEE1' }}>
                          {role.name}
                        </span>
                        <span className={cn(
                          "text-[9px] font-black uppercase tracking-[0.2em]",
                          allowed ? "text-neon-green" : "text-[#7b838a]"
                        )}>
                          {allowed ? 'Permitido' : 'Bloqueado'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-7 flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-white/85 text-[10px] font-black uppercase tracking-widest hover:bg-white/[0.08] transition-all"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className={cn(
                "px-4 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all",
                canSave
                  ? "bg-neon-blue/15 border-neon-blue/45 text-neon-blue hover:bg-neon-blue/25"
                  : "bg-white/[0.02] border-white/10 text-[#6B7280] cursor-not-allowed"
              )}
            >
              Guardar cambios
            </button>
          </div>
        </div>
    </ModalBase>
  );
};
