import React, { useEffect, useState } from 'react';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { Bot, Crown } from 'lucide-react';
import { NitroEmblems } from '../ui/NitroEmblems';
import { getPrimaryMemberRole, getRoleNamePresentation, getRoleSolidColor } from '../../lib/role-style';

export const MemberSidebar = () => {
  const { servers, users, activeServerId, presences, currentUser } = useStore();
  const [nitroActive, setNitroActive] = useState(false);

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
  
  const activeServer = servers.find(s => s.id === activeServerId);
  if (!activeServer) return null;

  // Group members by their highest role
  const roles = [...activeServer.roles].sort((a, b) => (b.position || 0) - (a.position || 0));
  
  return (
    <div className="w-[260px] bg-[#0A0A0B] glass-ruby-shell flex flex-col h-full overflow-hidden border-l border-white/[0.03]">
      <div className="h-16 px-6 border-b border-white/[0.03] glass-ruby-strip flex items-center bg-white/[0.01]">
        <h2 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Synchronization</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pt-6 space-y-8 no-scrollbar">
        {roles.map(role => {
          const roleMembers = activeServer.members.filter(m => m.roleIds.includes(role.id));
          if (roleMembers.length === 0) return null;

          return (
            <div key={role.id} className="space-y-3">
              <div className="px-4 flex items-center justify-between">
                <h3 className="text-[9px] font-black text-[#4E5058] uppercase tracking-[0.2em]">
                  {role.name} <span className="opacity-40 ml-1">// {roleMembers.length}</span>
                </h3>
              </div>

              <div className="space-y-1">
                {roleMembers.map(member => {
                  const presence = presences[member.userId];
                  const user = users.find((u) => u.id === member.userId);
                  const username = user?.displayName || user?.username || 'Unknown';
                  const isBot = Boolean(user?.isBot);
                  const isOwner = activeServer.ownerId === member.userId;
                  const avatar = user?.avatar || null;
                  const primaryRole = getPrimaryMemberRole(activeServer, member.userId);
                  const roleNamePresentation = getRoleNamePresentation(primaryRole);

                  return (
                    <button
                      key={member.userId}
                      className="flex items-center gap-3 w-full px-4 py-2 rounded-xl hover:bg-white/[0.03] transition-all group border border-transparent hover:border-white/[0.05]"
                    >
                      <div className="relative flex-shrink-0">
                        <div className={cn(
                          "relative w-9 h-9 rounded-[14px]",
                        )}>
                          <div className={cn(
                            "w-9 h-9 rounded-[14px] bg-[#1E1F22] p-[1.5px] transition-transform duration-300 group-hover:scale-105",
                            presence?.status === 'online' ? "ring-1 ring-neon-green/20" : ""
                          )}>
                            <div className="w-full h-full rounded-[inherit] overflow-hidden bg-[#0A0A0B]">
                              {avatar ? (
                                <img src={avatar} alt={username} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-xs font-black text-white" style={{ color: getRoleSolidColor(primaryRole || role, '#B5BAC1') }}>
                                  {username[0]?.toUpperCase() || '?'}
                                </div>
                              )}
                            </div>
                          </div>
                          {nitroActive && currentUser && member.userId === currentUser.id && (
                            <div className="absolute -bottom-2 -right-2">
                              <NitroEmblems size={10} compact />
                            </div>
                          )}
                          <div className={cn(
                            "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-lg border-[3.5px] border-[#0A0A0B] shadow-sm",
                            presence?.status === 'online' ? "bg-neon-green" : presence?.status === 'dnd' ? "bg-neon-pink" : "bg-[#4E5058]"
                          )} />
                        </div>
                      </div>

                      <div className="min-w-0 text-left">
                        <div className="flex items-center gap-1.5">
                          <span className={cn("text-sm font-black truncate tracking-tight text-white/80 group-hover:text-white transition-colors", roleNamePresentation.className)} style={roleNamePresentation.style}>
                            {username}
                          </span>
                          {isOwner && <Crown size={11} className="text-yellow-400" />}
                          {isBot && <Bot size={10} className="text-neon-blue" />}
                        </div>
                        {presence?.activity && (
                          <div className="text-[9px] font-black uppercase tracking-widest text-[#4E5058] truncate group-hover:text-[#B5BAC1] transition-colors">
                            {presence.activity.name}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
