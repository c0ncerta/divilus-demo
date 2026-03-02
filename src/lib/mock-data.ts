import { User, Server, Message, Presence } from './types';

const USERS: Record<string, User> = {
  '1': { id: '1', username: 'Andri', discriminator: '0001', status: 'online', bio: 'Expert Frontend Engineer & UI/UX Enthusiast.', bannerColor: '#C2183C', serverIds: ['server-1'] },
  '2': { id: '2', username: 'Nelly', discriminator: '1337', status: 'dnd', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Nelly', bio: 'Designing the future, one pixel at a time.', bannerColor: '#8E1330', serverIds: ['server-1'] },
  '3': { id: '3', username: 'CyborgBot', discriminator: '9999', status: 'online', isBot: true, avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Cyborg', bio: 'Beep boop. I am here to help.', bannerColor: '#5A1023', serverIds: ['server-1'] },
  '4': { id: '4', username: 'Ghosty', discriminator: '6666', status: 'idle', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Ghosty', bio: 'I haunt the code.', bannerColor: '#00FF94', serverIds: ['server-1'] },
};

export const initialData = {
  currentUser: USERS['1'],
  servers: [
    {
      id: 'server-1',
      name: 'Project Alpha',
      description: 'Servidor principal para coordinar producto, voz y builds.',
      tag: 'ALFA',
      accentColor: '#C2183C',
      icon: 'https://api.dicebear.com/7.x/identicon/svg?seed=Alpha',
      ownerId: '1',
      members: [
        { userId: '1', serverId: 'server-1', roleIds: ['admin-role'], joinedAt: new Date().toISOString() },
        { userId: '2', serverId: 'server-1', roleIds: ['member-role'], joinedAt: new Date().toISOString() },
        { userId: '3', serverId: 'server-1', roleIds: ['bot-role'], joinedAt: new Date().toISOString() },
      ],
      roles: [
        { id: 'admin-role', name: 'Admin', color: '#ff4757', permissions: ['ADMINISTRATOR'], position: 0, hoist: true, mentionable: true },
        { id: 'member-role', name: 'Developer', color: '#2ed573', permissions: ['SEND_MESSAGES', 'READ_MESSAGES'], position: 1, hoist: true, mentionable: true },
        { id: 'bot-role', name: 'Bot', color: '#70a1ff', permissions: ['SEND_MESSAGES'], position: 2, hoist: true, mentionable: false },
      ],
      categories: [
        {
          id: 'cat-1',
          name: 'General',
          channels: [
            { id: 'chan-1', name: 'welcome', type: 'text', topic: 'The start of everything' },
            { id: 'chan-2', name: 'general', type: 'text' },
            { id: 'chan-3', name: 'Voice Lounge', type: 'voice' },
          ]
        },
        {
          id: 'cat-2',
          name: 'Development',
          channels: [
            { id: 'chan-4', name: 'frontend', type: 'text' },
            { id: 'chan-5', name: 'backend', type: 'text' },
          ]
        }
      ]
    },
    {
      id: 'server-2',
      name: 'UI/UX Design',
      description: 'Recursos visuales, prototipos y feedback de interfaz.',
      tag: 'UX',
      accentColor: '#8E1330',
      icon: 'https://api.dicebear.com/7.x/identicon/svg?seed=Design',
      ownerId: '2',
      members: [
        { userId: '1', serverId: 'server-2', roleIds: ['member-role'], joinedAt: new Date().toISOString() },
        { userId: '2', serverId: 'server-2', roleIds: ['admin-role'], joinedAt: new Date().toISOString() },
      ],
      roles: [
        { id: 'admin-role', name: 'Lead Designer', color: '#eccc68', permissions: ['ADMINISTRATOR'], position: 0, hoist: true, mentionable: true },
      ],
      categories: [
        {
          id: 'cat-3',
          name: 'Resources',
          channels: [
            { id: 'chan-6', name: 'inspiration', type: 'text' },
            { id: 'chan-7', name: 'figma-links', type: 'text' },
          ]
        }
      ]
    }
  ] as Server[],
  messages: {
    'chan-1': [
      { id: 'm1', channelId: 'chan-1', authorId: '1', content: 'Welcome to Project Alpha! 🚀', timestamp: new Date(Date.now() - 3600000).toISOString() },
      { id: 'm2', channelId: 'chan-1', authorId: '2', content: 'Thanks for having me here.', timestamp: new Date(Date.now() - 3000000).toISOString() },
    ],
    'chan-2': [
      { id: 'm3', channelId: 'chan-2', authorId: '1', content: 'Did anyone check the new PR?', timestamp: new Date(Date.now() - 1000000).toISOString() },
      { id: 'm4', channelId: 'chan-2', authorId: '3', content: 'PR #42 is passing all tests. Beep boop.', timestamp: new Date(Date.now() - 800000).toISOString() },
    ]
  } as Record<string, Message[]>,
  presences: {
    '1': { userId: '1', status: 'online' },
    '2': { userId: '2', status: 'dnd', activity: { type: 'playing', name: 'Figma' } },
    '3': { userId: '3', status: 'online', activity: { type: 'custom', name: 'Monitoring builds...' } },
    '4': { userId: '4', status: 'idle' },
  } as Record<string, Presence>
};
