import type { Message, Presence, Server, User } from './types';

// Use a deterministic timestamp so SSR and client hydration produce identical values.
// Rounded to the start of the current day (UTC) for stability across renders.
const today = new Date();
const now = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12, 0, 0)).getTime();
const isoMinutesAgo = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

const DEMO_USERS: Record<string, User> = {
  'demo-user': {
    id: 'demo-user',
    username: 'Demo User',
    displayName: 'Demo User',
    discriminator: '0001',
    status: 'online',
    bio: 'Cuenta ficticia para demo publica. Sin login y sin backend.',
    avatar: '/logo.png',
    bannerColor: '#7A1027',
    serverIds: ['demo-server-1', 'demo-server-2'],
  },
  'demo-mod': {
    id: 'demo-mod',
    username: 'ModGuard',
    displayName: 'Mod Guard',
    discriminator: '2048',
    status: 'online',
    avatar: '/icons/icon-192.png',
    bio: 'Moderacion de ejemplo en modo demo.',
    serverIds: ['demo-server-1', 'demo-server-2'],
  },
  'demo-designer': {
    id: 'demo-designer',
    username: 'PixelJane',
    displayName: 'Pixel Jane',
    discriminator: '3344',
    status: 'idle',
    avatar: '/logo.png',
    bio: 'UI designer del equipo demo.',
    serverIds: ['demo-server-1'],
  },
  'demo-bot': {
    id: 'demo-bot',
    username: 'TicketBot',
    displayName: 'Ticket Bot',
    discriminator: '9999',
    status: 'online',
    isBot: true,
    avatar: '/icons/icon-192.png',
    bio: 'Bot de soporte simulado para abrir y cerrar tickets.',
    serverIds: ['demo-server-1', 'demo-server-2'],
  },
  'demo-friend-1': {
    id: 'demo-friend-1',
    username: 'NovaStar',
    displayName: 'Nova Star',
    discriminator: '7782',
    status: 'idle',
    bannerColor: '#7c3aed',
    bio: 'Diseñadora de interfaces. Siempre a la caza de buenas animaciones.',
    serverIds: ['demo-server-1'],
    customStatus: 'Retocando paletas de color 🎨',
  },
  'demo-friend-2': {
    id: 'demo-friend-2',
    username: 'RyuKen',
    displayName: 'Ryu Ken',
    discriminator: '5501',
    status: 'online',
    bannerColor: '#0369a1',
    bio: 'Backend developer. Amo el café y los sistemas distribuidos.',
    serverIds: ['demo-server-1'],
    customStatus: 'Debugeando en prod 🔥',
  },
};

const DEMO_SERVERS: Server[] = [
  {
    id: 'demo-server-1',
    name: 'DiavloCord Demo Hub',
    description: 'Servidor publico de demostracion con datos simulados.',
    tag: 'DEMO',
    accentColor: '#7A1027',
    icon: '/logo.png',
    ownerId: 'demo-user',
    members: [
      { userId: 'demo-user', serverId: 'demo-server-1', roleIds: ['role-owner'], joinedAt: isoMinutesAgo(2_000) },
      { userId: 'demo-mod', serverId: 'demo-server-1', roleIds: ['role-mod'], joinedAt: isoMinutesAgo(1_500) },
      { userId: 'demo-designer', serverId: 'demo-server-1', roleIds: ['role-member'], joinedAt: isoMinutesAgo(1_100) },
      { userId: 'demo-bot', serverId: 'demo-server-1', roleIds: ['role-bot'], joinedAt: isoMinutesAgo(900) },
      { userId: 'demo-friend-1', serverId: 'demo-server-1', roleIds: ['role-member'], joinedAt: isoMinutesAgo(800) },
      { userId: 'demo-friend-2', serverId: 'demo-server-1', roleIds: ['role-member'], joinedAt: isoMinutesAgo(750) },
    ],
    roles: [
      {
        id: 'role-owner',
        name: 'Owner',
        color: '#ff5f8f',
        permissions: ['ADMINISTRATOR'],
        position: 0,
        hoist: true,
        mentionable: false,
      },
      {
        id: 'role-mod',
        name: 'Moderator',
        color: '#5dd6ff',
        permissions: ['MANAGE_MESSAGES', 'READ_MESSAGES', 'SEND_MESSAGES', 'VIEW_CHANNEL'],
        position: 1,
        hoist: true,
        mentionable: true,
      },
      {
        id: 'role-member',
        name: 'Member',
        color: '#71f9a2',
        permissions: ['READ_MESSAGES', 'SEND_MESSAGES', 'VIEW_CHANNEL', 'ATTACH_FILES'],
        position: 2,
        hoist: false,
        mentionable: true,
      },
      {
        id: 'role-bot',
        name: 'Bot',
        color: '#8ea2ff',
        permissions: ['READ_MESSAGES', 'SEND_MESSAGES', 'VIEW_CHANNEL'],
        position: 3,
        hoist: false,
        mentionable: false,
      },
    ],
    categories: [
      {
        id: 'cat-community',
        name: 'Community',
        channels: [
          { id: 'ch-announcements', name: 'announcements', type: 'announcement', topic: 'Anuncios oficiales de la demo' },
          { id: 'ch-general', name: 'general', type: 'text', topic: 'Chat general de la demo' },
          { id: 'ch-showcase', name: 'showcase', type: 'text', topic: 'Muestra de proyectos y resultados' },
          { id: 'ch-voice-lobby', name: 'voice-lobby', type: 'voice', userLimit: 8 },
        ],
      },
      {
        id: 'cat-support',
        name: 'Support',
        channels: [
          { id: 'ch-tickets', name: 'tickets', type: 'text', topic: 'Canal de tickets simulado' },
          { id: 'ch-ticket-demo-0001', name: 'ticket-demo-0001', type: 'text', topic: 'Ticket de ejemplo cerrado' },
        ],
      },
    ],
    invites: [
      {
        code: 'demohub',
        createdBy: 'demo-user',
        createdAt: isoMinutesAgo(400),
        uses: 17,
        maxUses: null,
        expiresAt: null,
        revoked: false,
        revokedAt: null,
      },
    ],
  },
  {
    id: 'demo-server-2',
    name: 'Product Roadmap',
    description: 'Segundo workspace de ejemplo para roadmap y seguimiento.',
    tag: 'ROAD',
    accentColor: '#8B1A40',
    icon: '/icons/icon-192.png',
    ownerId: 'demo-mod',
    members: [
      { userId: 'demo-user', serverId: 'demo-server-2', roleIds: ['role-member-2'], joinedAt: isoMinutesAgo(2_200) },
      { userId: 'demo-mod', serverId: 'demo-server-2', roleIds: ['role-owner-2'], joinedAt: isoMinutesAgo(2_500) },
      { userId: 'demo-bot', serverId: 'demo-server-2', roleIds: ['role-bot-2'], joinedAt: isoMinutesAgo(1_300) },
    ],
    roles: [
      {
        id: 'role-owner-2',
        name: 'Lead',
        color: '#ffd782',
        permissions: ['ADMINISTRATOR'],
        position: 0,
        hoist: true,
        mentionable: true,
      },
      {
        id: 'role-member-2',
        name: 'Contributor',
        color: '#95f5ff',
        permissions: ['READ_MESSAGES', 'SEND_MESSAGES', 'VIEW_CHANNEL'],
        position: 1,
        hoist: true,
        mentionable: true,
      },
      {
        id: 'role-bot-2',
        name: 'Automation',
        color: '#a79bff',
        permissions: ['READ_MESSAGES', 'SEND_MESSAGES', 'VIEW_CHANNEL'],
        position: 2,
        hoist: false,
        mentionable: false,
      },
    ],
    categories: [
      {
        id: 'cat-roadmap',
        name: 'Roadmap',
        channels: [
          { id: 'ch-roadmap', name: 'roadmap', type: 'text', topic: 'Prioridades de producto y seguimiento' },
          { id: 'ch-release', name: 'release-notes', type: 'announcement', topic: 'Notas de version simuladas' },
        ],
      },
    ],
    invites: [
      {
        code: 'roadmap',
        createdBy: 'demo-mod',
        createdAt: isoMinutesAgo(2_000),
        uses: 6,
        maxUses: null,
        expiresAt: null,
        revoked: false,
        revokedAt: null,
      },
    ],
  },
];

const DEMO_MESSAGES: Record<string, Message[]> = {
  'ch-announcements': [
    {
      id: 'msg-ann-1',
      channelId: 'ch-announcements',
      authorId: 'demo-mod',
      content: 'Bienvenido a la demo publica. Todos los datos son simulados.',
      timestamp: isoMinutesAgo(240),
    },
    {
      id: 'msg-ann-2',
      channelId: 'ch-announcements',
      authorId: 'demo-bot',
      content: 'Modo demo activo: acciones administrativas reales deshabilitadas.',
      timestamp: isoMinutesAgo(220),
    },
  ],
  'ch-general': [
    {
      id: 'msg-gen-1',
      channelId: 'ch-general',
      authorId: 'demo-user',
      content: 'Esta instancia arranca sin login ni base de datos.',
      timestamp: isoMinutesAgo(120),
    },
    {
      id: 'msg-gen-2',
      channelId: 'ch-general',
      authorId: 'demo-designer',
      content: 'Perfecto para enseñar UX y navegacion sin romper nada real.',
      timestamp: isoMinutesAgo(110),
    },
  ],
  'ch-showcase': [
    {
      id: 'msg-show-1',
      channelId: 'ch-showcase',
      authorId: 'demo-user',
      content: 'Proyecto: sistema de tickets y anuncios con auditoria.',
      timestamp: isoMinutesAgo(95),
    },
  ],
  'ch-tickets': [
    {
      id: 'msg-ticket-1',
      channelId: 'ch-tickets',
      authorId: 'demo-bot',
      content: 'Ticket #0001 abierto por Demo User. Estado: cerrado.',
      timestamp: isoMinutesAgo(75),
    },
    {
      id: 'msg-ticket-2',
      channelId: 'ch-tickets',
      authorId: 'demo-mod',
      content: 'Resolucion aplicada: acceso restablecido. Tiempo total: 12 min.',
      timestamp: isoMinutesAgo(60),
    },
  ],
  'ch-ticket-demo-0001': [
    {
      id: 'msg-ticket-thread-1',
      channelId: 'ch-ticket-demo-0001',
      authorId: 'demo-user',
      content: 'No puedo entrar al canal privado.',
      timestamp: isoMinutesAgo(140),
    },
    {
      id: 'msg-ticket-thread-2',
      channelId: 'ch-ticket-demo-0001',
      authorId: 'demo-mod',
      content: 'Permisos corregidos. Confirmamos cierre del ticket.',
      timestamp: isoMinutesAgo(128),
    },
  ],
  'ch-roadmap': [
    {
      id: 'msg-road-1',
      channelId: 'ch-roadmap',
      authorId: 'demo-mod',
      content: 'Q1: demo publica sin login + providers mock/real.',
      timestamp: isoMinutesAgo(180),
    },
  ],
  'ch-release': [
    {
      id: 'msg-rel-1',
      channelId: 'ch-release',
      authorId: 'demo-bot',
      content: 'v0.1-demo: entorno sin backend preparado para portfolio.',
      timestamp: isoMinutesAgo(165),
    },
  ],
};

const DEMO_PRESENCES: Record<string, Presence> = {
  'demo-user': { userId: 'demo-user', status: 'online', activity: { type: 'custom', name: 'Exploring demo mode' } },
  'demo-mod': { userId: 'demo-mod', status: 'online', activity: { type: 'playing', name: 'Moderating channels' } },
  'demo-designer': { userId: 'demo-designer', status: 'idle', activity: { type: 'watching', name: 'UI polish' } },
  'demo-bot': { userId: 'demo-bot', status: 'online', activity: { type: 'custom', name: 'Automating tickets' } },
  'demo-friend-1': { userId: 'demo-friend-1', status: 'idle', activity: { type: 'custom', name: 'Retocando paletas de color 🎨' } },
  'demo-friend-2': { userId: 'demo-friend-2', status: 'online', activity: { type: 'custom', name: 'Debugeando en prod 🔥' } },
};

const DEMO_DM_CONVERSATIONS = [
  {
    id: 'dm-demo-1',
    memberIds: ['demo-user', 'demo-mod'],
    messages: [
      {
        id: 'dm-msg-1',
        conversationId: 'dm-demo-1',
        authorId: 'demo-mod',
        content: 'Te paso estado del ticket 0001.',
        attachments: [],
        createdAt: isoMinutesAgo(35),
      },
      {
        id: 'dm-msg-2',
        conversationId: 'dm-demo-1',
        authorId: 'demo-user',
        content: 'Perfecto, gracias por la ayuda.',
        attachments: [],
        createdAt: isoMinutesAgo(28),
      },
    ],
  },
  {
    id: 'dm-demo-2',
    memberIds: ['demo-user', 'demo-friend-1'],
    messages: [
      {
        id: 'dm-f1-1',
        conversationId: 'dm-demo-2',
        authorId: 'demo-friend-1',
        content: 'Oye, ¿has visto el nuevo diseño? Lo acaban de subir al showcase 👀',
        attachments: [],
        createdAt: isoMinutesAgo(18),
      },
      {
        id: 'dm-f1-2',
        conversationId: 'dm-demo-2',
        authorId: 'demo-user',
        content: 'Sí, está bastante limpio. Me gusta cómo manejaron el espaciado.',
        attachments: [],
        createdAt: isoMinutesAgo(15),
      },
      {
        id: 'dm-f1-3',
        conversationId: 'dm-demo-2',
        authorId: 'demo-friend-1',
        content: '¿Te parece si hacemos una revisión conjunta mañana? Tengo un par de ideas para el tema oscuro 🎨',
        attachments: [],
        createdAt: isoMinutesAgo(12),
      },
    ],
  },
  {
    id: 'dm-demo-3',
    memberIds: ['demo-user', 'demo-friend-2'],
    messages: [
      {
        id: 'dm-f2-1',
        conversationId: 'dm-demo-3',
        authorId: 'demo-friend-2',
        content: 'El endpoint de usuarios finalmente responde en <100ms 🚀',
        attachments: [],
        createdAt: isoMinutesAgo(45),
      },
      {
        id: 'dm-f2-2',
        conversationId: 'dm-demo-3',
        authorId: 'demo-user',
        content: '¡Brutal! ¿Cómo lo conseguiste? ¿Caching?',
        attachments: [],
        createdAt: isoMinutesAgo(42),
      },
      {
        id: 'dm-f2-3',
        conversationId: 'dm-demo-3',
        authorId: 'demo-friend-2',
        content: 'Exacto, Redis + índices en la query. Ya te mando el PR para revisión.',
        attachments: [],
        createdAt: isoMinutesAgo(38),
      },
      {
        id: 'dm-f2-4',
        conversationId: 'dm-demo-3',
        authorId: 'demo-user',
        content: 'Dale, lo reviso esta tarde 👍',
        attachments: [],
        createdAt: isoMinutesAgo(36),
      },
    ],
  },
];

export const demoData = {
  currentUser: DEMO_USERS['demo-user'],
  users: Object.values(DEMO_USERS),
  servers: DEMO_SERVERS,
  messages: DEMO_MESSAGES,
  presences: DEMO_PRESENCES,
  dmGroups: DEMO_DM_CONVERSATIONS.map((c) => ({ id: c.id, memberIds: c.memberIds })),
  dmMessages: DEMO_DM_CONVERSATIONS.reduce<Record<string, { id: string; channelId: string; authorId: string; content: string; timestamp: string }[]>>((acc, c) => {
    acc[c.id] = c.messages.map((m) => ({
      id: m.id,
      channelId: c.id,
      authorId: m.authorId,
      content: m.content,
      timestamp: m.createdAt,
    }));
    return acc;
  }, {}),
};

export const buildDemoBootstrapData = (options?: { includeUsers?: boolean; includeMessages?: boolean }) => {
  const includeUsers = options?.includeUsers !== false;
  const includeMessages = options?.includeMessages !== false;

  return {
    users: includeUsers ? demoData.users : [],
    dmConversations: DEMO_DM_CONVERSATIONS.map((conversation) => ({
      ...conversation,
      messages: includeMessages ? conversation.messages : [],
    })),
    dmRequestsIncoming: [],
    dmRequestsOutgoing: [],
  };
};

export const buildDemoWorkspaceSnapshot = () => ({
  servers: demoData.servers,
  messages: demoData.messages,
  presences: demoData.presences,
  activeServerId: demoData.servers[0]?.id ?? null,
  activeChannelId: demoData.servers[0]?.categories?.[0]?.channels?.[0]?.id ?? null,
  memberTimeouts: {},
  serverBans: {},
  auditLog: {},
  threads: {},
  threadMessages: {},
  activeThreadId: null,
});
