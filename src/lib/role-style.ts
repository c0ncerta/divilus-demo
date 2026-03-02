import type { Role, RoleNameEffect, Server } from './types';

export const getMemberRoles = (server: Server | undefined, userId: string): Role[] => {
  if (!server) return [];
  const member = server.members.find((m) => m.userId === userId);
  if (!member) return [];
  return server.roles
    .filter((role) => member.roleIds.includes(role.id))
    // Highest position role should win visual priority (Discord-like).
    .sort((a, b) => (b.position || 0) - (a.position || 0));
};

export const getPrimaryMemberRole = (server: Server | undefined, userId: string): Role | null => {
  const roles = getMemberRoles(server, userId);
  return roles[0] || null;
};

const isGradientColor = (value: string) => /gradient\(/i.test(value);

export const getRoleSolidColor = (role: Role | null | undefined, fallback = '#B5BAC1'): string => {
  const rawColor = String(role?.color || '').trim();
  if (!rawColor || isGradientColor(rawColor)) return fallback;
  return rawColor;
};

export type RoleNamePresentation = {
  className: string;
  style?: Record<string, string>;
  colorToken?: string;
};

const effectClass: Record<RoleNameEffect, string> = {
  none: '',
  pulse: 'role-name-pulse',
  neon: 'role-name-neon',
  rainbow: 'role-name-rainbow',
  glitch: 'role-name-glitch',
  shimmer: 'role-name-shimmer',
};

export const getRoleNamePresentation = (role: Role | null | undefined): RoleNamePresentation => {
  if (!role) {
    return {
      className: '',
      style: { color: '#B5BAC1' },
      colorToken: '#B5BAC1',
    };
  }

  const rawColor = String(role.color || '').trim();
  const normalizedColor = rawColor.length > 0 ? rawColor : '#B5BAC1';
  const roleEffect = role.nameEffect || 'none';
  const className = effectClass[roleEffect] || '';

  if (isGradientColor(normalizedColor)) {
    return {
      className,
      style: {
        backgroundImage: normalizedColor,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        WebkitTextFillColor: 'transparent',
      },
      colorToken: normalizedColor,
    };
  }

  return {
    className,
    style: { color: normalizedColor },
    colorToken: normalizedColor,
  };
};
