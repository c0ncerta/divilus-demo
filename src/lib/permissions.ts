import { Channel, Permission, Server } from './types';

const addAll = (set: Set<Permission>, values: Permission[]) => {
  for (const p of values) set.add(p);
};

const removeAll = (set: Set<Permission>, values: Permission[]) => {
  for (const p of values) set.delete(p);
};

export const getMemberPermissions = (
  server: Server | undefined,
  channel: Channel | undefined,
  userId: string
): Set<Permission> => {
  if (!server) return new Set();
  if (server.ownerId === userId) return new Set<Permission>(['ADMINISTRATOR']);

  const member = server.members.find((m) => m.userId === userId);
  if (!member) return new Set();

  const base = new Set<Permission>([
    'VIEW_CHANNEL',
    'READ_MESSAGES',
    'SEND_MESSAGES',
    'ATTACH_FILES',
    'CREATE_INSTANT_INVITE',
  ]);
  const roles = server.roles.filter((r) => member.roleIds.includes(r.id));
  for (const role of roles) addAll(base, role.permissions);

  if (base.has('ADMINISTRATOR')) return base;
  if (!channel?.permissionOverwrites || channel.permissionOverwrites.length === 0) return base;

  const roleOverwrites = channel.permissionOverwrites.filter(
    (ow) => ow.type === 'role' && member.roleIds.includes(ow.id)
  );
  for (const ow of roleOverwrites) {
    removeAll(base, ow.deny);
    addAll(base, ow.allow);
  }

  const userOverwrite = channel.permissionOverwrites.find(
    (ow) => ow.type === 'member' && ow.id === userId
  );
  if (userOverwrite) {
    removeAll(base, userOverwrite.deny);
    addAll(base, userOverwrite.allow);
  }

  return base;
};

export const hasPermission = (
  server: Server | undefined,
  channel: Channel | undefined,
  userId: string,
  permission: Permission
): boolean => {
  const perms = getMemberPermissions(server, channel, userId);
  return perms.has('ADMINISTRATOR') || perms.has(permission);
};
