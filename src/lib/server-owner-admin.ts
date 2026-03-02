import type { Member, Permission, Role, Server } from './types';

const OWNER_ROLE_ID_PREFIX = 'owner-role-';

const hasAdministratorPermission = (role: Role | undefined): boolean => {
  if (!role || !Array.isArray(role.permissions)) return false;
  return role.permissions.includes('ADMINISTRATOR');
};

export const ensureOwnerHasAdminRole = (server: Server): Server => {
  if (!server?.ownerId) return server;

  const roles = Array.isArray(server.roles) ? server.roles : [];
  const members = Array.isArray(server.members) ? server.members : [];
  const ownerId = server.ownerId;

  const ownerMemberIndex = members.findIndex((member) => member.userId === ownerId);
  const ownerMember = ownerMemberIndex >= 0 ? members[ownerMemberIndex] : null;
  const ownerRoleIds = new Set(Array.isArray(ownerMember?.roleIds) ? ownerMember!.roleIds : []);

  const ownerAlreadyHasAdmin = roles.some(
    (role) => ownerRoleIds.has(role.id) && hasAdministratorPermission(role)
  );

  // Normalize owner membership roleIds even when it already has administrator.
  if (ownerAlreadyHasAdmin && ownerMemberIndex >= 0 && Array.isArray(ownerMember?.roleIds)) {
    const normalizedRoleIds = Array.from(new Set(ownerMember!.roleIds));
    if (normalizedRoleIds.length === ownerMember!.roleIds.length) return server;
    const nextMembers = [...members];
    nextMembers[ownerMemberIndex] = { ...ownerMember!, roleIds: normalizedRoleIds };
    return { ...server, members: nextMembers };
  }

  const ownerRoleId = `${OWNER_ROLE_ID_PREFIX}${server.id}`;
  let nextRoles = roles;
  let roleIdToAssign = ownerRoleId;

  const ownerRoleIndex = roles.findIndex((role) => role.id === ownerRoleId);
  if (ownerRoleIndex >= 0) {
    const ownerRole = roles[ownerRoleIndex];
    if (!hasAdministratorPermission(ownerRole)) {
      const nextPermissions = Array.from(
        new Set<Permission>([...(ownerRole.permissions || []), 'ADMINISTRATOR'])
      );
      nextRoles = [...roles];
      nextRoles[ownerRoleIndex] = { ...ownerRole, permissions: nextPermissions };
    }
  } else {
    const topPosition = roles.reduce((max, role) => Math.max(max, role.position || 0), 0) + 1;
    const ownerRole: Role = {
      id: ownerRoleId,
      name: 'Server Owner',
      color: '#F0B232',
      permissions: ['ADMINISTRATOR'],
      position: topPosition,
      hoist: true,
      mentionable: false,
    };
    nextRoles = [...roles, ownerRole];
  }

  let nextMembers = members;
  if (ownerMemberIndex >= 0) {
    const existingRoleIds = Array.isArray(ownerMember?.roleIds) ? ownerMember!.roleIds : [];
    if (!existingRoleIds.includes(roleIdToAssign)) {
      nextMembers = [...members];
      nextMembers[ownerMemberIndex] = {
        ...ownerMember!,
        roleIds: Array.from(new Set([...existingRoleIds, roleIdToAssign])),
      };
    } else if (!Array.isArray(ownerMember?.roleIds)) {
      nextMembers = [...members];
      nextMembers[ownerMemberIndex] = {
        ...ownerMember!,
        roleIds: [roleIdToAssign],
      };
    }
  } else {
    const ownerMembership: Member = {
      userId: ownerId,
      serverId: server.id,
      roleIds: [roleIdToAssign],
      joinedAt: new Date().toISOString(),
    };
    nextMembers = [...members, ownerMembership];
  }

  if (nextRoles === roles && nextMembers === members) return server;
  return {
    ...server,
    roles: nextRoles,
    members: nextMembers,
  };
};

export const ensureOwnersHaveAdminRole = (servers: Server[]): Server[] => {
  let changed = false;
  const nextServers = servers.map((server) => {
    const next = ensureOwnerHasAdminRole(server);
    if (next !== server) changed = true;
    return next;
  });
  return changed ? nextServers : servers;
};
