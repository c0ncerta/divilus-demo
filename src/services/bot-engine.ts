import { useStore } from '../lib/store';
import { eventBus } from '../lib/event-bus';
import { Message } from '../lib/types';
import { v4 as uuidv4 } from 'uuid';

const BOT_RESPONSES = [
  "That sounds interesting!",
  "I'm working on the design system right now.",
  "Check out this new component I found.",
  "Beep boop. Everything is looking good.",
  "Does anyone want to jump into a voice call?",
  "I just pushed a fix for the layout issues.",
  "The dark mode looks amazing in this build.",
  "We should probably refactor the store logic soon.",
];

const BOT_USERS = ['2', '3', '4']; // Nelly, CyborgBot, Ghosty
const REACT_EMOJIS = ['😂', '👍', '❤️', '🎉', '👀', '🔥', '✅', '😮'];
const STATUSES = ['online', 'idle', 'dnd'] as const;

export class BotEngine {
  private interval: any = null;
  private presenceInterval: any = null;
  private voiceInterval: any = null;
  private isRunning: boolean = false;

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNext();
    this.schedulePresenceFlips();
    this.scheduleVoiceChaos();
  }

  stop() {
    this.isRunning = false;
    if (this.interval) clearTimeout(this.interval);
    if (this.presenceInterval) clearInterval(this.presenceInterval);
    if (this.voiceInterval) clearInterval(this.voiceInterval);
  }

  private scheduleNext() {
    if (!this.isRunning) return;
    
    const delay = Math.random() * 15000 + 5000; // 5-20 seconds
    this.interval = setTimeout(() => {
      this.performAction();
      this.scheduleNext();
    }, delay);
  }

  private schedulePresenceFlips() {
    // Every ~10s, randomly adjust bot presences to make the UI feel alive.
    this.presenceInterval = setInterval(() => {
      if (!this.isRunning) return;
      const state = useStore.getState();
      const botId = BOT_USERS[Math.floor(Math.random() * BOT_USERS.length)];
      const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
      const activity =
        Math.random() < 0.5
          ? { type: 'custom' as const, name: 'Vibing', state: 'In a demo' }
          : { type: 'playing' as const, name: 'DiavloCord' };

      const presence = { userId: botId, status, activity };
      state.setPresence(botId, presence);
      eventBus.emit('PRESENCE_UPDATE', { userId: botId, presence });
    }, 10000);
  }

  private scheduleVoiceChaos() {
    // Every ~6s, bots may join/leave voice and "speak".
    this.voiceInterval = setInterval(() => {
      if (!this.isRunning) return;
      const state = useStore.getState();
      const server = state.servers[Math.floor(Math.random() * state.servers.length)];
      const voiceChannels = server.categories.flatMap(c => c.channels).filter(c => c.type === 'voice');
      if (voiceChannels.length === 0) return;

      const channel = voiceChannels[Math.floor(Math.random() * voiceChannels.length)];
      const botId = BOT_USERS[Math.floor(Math.random() * BOT_USERS.length)];
      const voiceState = state.voice[channel.id];
      const connected = voiceState?.connectedUserIds?.includes(botId) ?? false;

      // 40% chance toggle join/leave
      if (Math.random() < 0.4) {
        if (connected) state.voiceLeave(channel.id, botId);
        else state.voiceJoin(channel.id, botId);
        return;
      }

      // If connected, 60% chance "speak" burst
      if (connected && Math.random() < 0.6) {
        state.setSpeaking(channel.id, botId, true);
        setTimeout(() => state.setSpeaking(channel.id, botId, false), 700 + Math.random() * 900);
      }
    }, 6000);
  }

  private async performAction() {
    const state = useStore.getState();
    const server = state.servers[Math.floor(Math.random() * state.servers.length)];
    const category = server.categories[Math.floor(Math.random() * server.categories.length)];
    const channel = category.channels.find(c => c.type === 'text');
    
    if (!channel) return;

    const botId = BOT_USERS[Math.floor(Math.random() * BOT_USERS.length)];

    const roll = Math.random();

    // 65%: send a message (typing -> message)
    if (roll < 0.65) {
      eventBus.emit('TYPING_START', { channelId: channel.id, userId: botId });
      await new Promise(resolve => setTimeout(resolve, Math.random() * 2500 + 600));
      eventBus.emit('TYPING_STOP', { channelId: channel.id, userId: botId });

      const newMessage: Message = {
        id: uuidv4(),
        channelId: channel.id,
        authorId: botId,
        content: BOT_RESPONSES[Math.floor(Math.random() * BOT_RESPONSES.length)],
        timestamp: new Date().toISOString(),
      };

      state.addMessage(channel.id, newMessage);
      eventBus.emit('MESSAGE_CREATED', { channelId: channel.id, message: newMessage });
      return;
    }

    // 25%: react to the latest message in that channel
    if (roll < 0.90) {
      const list = state.messages[channel.id] || [];
      const last = list[list.length - 1];
      if (!last) return;
      const emoji = REACT_EMOJIS[Math.floor(Math.random() * REACT_EMOJIS.length)];
      state.toggleReaction(channel.id, last.id, emoji, botId);
      eventBus.emit('REACTION_TOGGLED', { channelId: channel.id, messageId: last.id, emoji, userId: botId });
      return;
    }

    // 10%: brief typing tease (no message)
    eventBus.emit('TYPING_START', { channelId: channel.id, userId: botId });
    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 1200));
    eventBus.emit('TYPING_STOP', { channelId: channel.id, userId: botId });
  }
}

export const botEngine = new BotEngine();
