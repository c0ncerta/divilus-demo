import type { Permission } from './types';

export type ServerCommandDefinition = {
  name: string;
  usage: string;
  description: string;
  requiredPermission: Permission | null;
  aliases?: string[];
};

export const SERVER_COMMANDS: ServerCommandDefinition[] = [
  {
    name: 'help',
    usage: '/help',
    description: 'Muestra la lista de comandos y permisos requeridos.',
    requiredPermission: null,
    aliases: ['h'],
  },
  {
    name: 'kick',
    usage: '/kick <usuario>',
    description: 'Expulsa a un miembro del servidor.',
    requiredPermission: 'MANAGE_SERVER',
  },
  {
    name: 'ban',
    usage: '/ban <usuario> [motivo]',
    description: 'Banea a un miembro del servidor.',
    requiredPermission: 'MANAGE_SERVER',
  },
  {
    name: 'unban',
    usage: '/unban <usuario>',
    description: 'Quita el ban de un usuario.',
    requiredPermission: 'MANAGE_SERVER',
  },
  {
    name: 'timeout',
    usage: '/timeout <usuario> [minutos]',
    description: 'Aplica timeout temporal al usuario.',
    requiredPermission: 'MANAGE_MESSAGES',
    aliases: ['mute'],
  },
  {
    name: 'untimeout',
    usage: '/untimeout <usuario>',
    description: 'Quita timeout al usuario.',
    requiredPermission: 'MANAGE_MESSAGES',
    aliases: ['unmute'],
  },
  {
    name: 'clear',
    usage: '/clear [cantidad]',
    description: 'Borra mensajes recientes del canal actual.',
    requiredPermission: 'MANAGE_MESSAGES',
    aliases: ['purge'],
  },
];

export const resolveServerCommand = (name: string): ServerCommandDefinition | null => {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  return (
    SERVER_COMMANDS.find(
      (cmd) =>
        cmd.name.toLowerCase() === normalized ||
        (cmd.aliases || []).some((alias) => alias.toLowerCase() === normalized)
    ) || null
  );
};

