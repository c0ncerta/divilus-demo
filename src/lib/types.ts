export type UserStatus = 'online' | 'idle' | 'dnd' | 'offline';

export interface User {
  id: string;
  username: string;
  displayName?: string;
  discriminator: string;
  avatar?: string;
  banner?: string;
  bannerColor?: string;
  bio?: string;
  pronouns?: string;
  createdAt?: string;
  updatedAt?: string;
  status: UserStatus;
  customStatus?: string;
  isBot?: boolean;
  password?: string;
  recoveryCode?: string;
  serverIds: string[];
}

export type RoleNameEffect = 'none' | 'pulse' | 'neon' | 'rainbow' | 'glitch' | 'shimmer';

export interface Role {
  id: string;
  name: string;
  color: string;
  nameEffect?: RoleNameEffect;
  permissions: Permission[];
  position: number;
  hoist: boolean; // Display role members separately
  mentionable: boolean;
}

export type Permission = 
  | 'ADMINISTRATOR'
  | 'MANAGE_SERVER'
  | 'MANAGE_CHANNELS'
  | 'MANAGE_ROLES'
  | 'VIEW_AUDIT_LOG'
  | 'MANAGE_MESSAGES'
  | 'SEND_MESSAGES'
  | 'READ_MESSAGES'
  | 'ATTACH_FILES'
  | 'CREATE_INSTANT_INVITE'
  | 'VIEW_CHANNEL';

export interface Server {
  id: string;
  name: string;
  description?: string;
  tag?: string;
  accentColor?: string;
  icon?: string;
  banner?: string;
  ownerId: string;
  roles: Role[];
  categories: Category[];
  members: Member[];
  invites?: ServerInvite[];
  stickers?: ServerSticker[];
}

export interface ServerSticker {
  id: string;
  name: string;
  url: string;
  contentType: string;
  size: number;
  animated?: boolean;
  createdAt?: string;
  createdBy?: string;
}

export interface ServerInvite {
  code: string;
  createdBy: string;
  createdAt: string;
  uses: number;
  maxUses?: number | null;
  expiresAt?: string | null;
  revoked?: boolean;
  revokedAt?: string | null;
}

export interface Category {
  id: string;
  name: string;
  channels: Channel[];
}

export type ChannelType = 'text' | 'voice' | 'announcement';

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  topic?: string;
  userLimit?: number | null;
  parentId?: string; // Category ID
  permissionOverwrites?: PermissionOverwrite[];
}

export interface PermissionOverwrite {
  id: string; // User or Role ID
  type: 'member' | 'role';
  allow: Permission[];
  deny: Permission[];
}

export interface Member {
  userId: string;
  serverId: string;
  nickname?: string;
  roleIds: string[];
  joinedAt: string;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  timestamp: string;
  editedAt?: string;
  isPinned?: boolean;
  attachments?: Attachment[];
  reactions?: Reaction[];
  replyToId?: string;
  threadId?: string;
}

export interface DMGroup {
  id: string;
  name?: string;
  memberIds: string[];
  lastMessageId?: string;
}

export interface Attachment {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface Thread {
  id: string;
  parentId: string; // Message ID
  channelId: string;
  name: string;
  messageCount: number;
  memberCount: number;
  archiveTimestamp: string;
}

export interface Presence {
  userId: string;
  status: UserStatus;
  activity?: {
    type: 'playing' | 'streaming' | 'listening' | 'watching' | 'custom';
    name: string;
    state?: string;
    details?: string;
  };
}
