type EventType = 
  | 'MESSAGE_CREATED'
  | 'MESSAGE_UPDATED'
  | 'MESSAGE_DELETED'
  | 'REACTION_TOGGLED'
  | 'TYPING_START'
  | 'TYPING_STOP'
  | 'PRESENCE_UPDATE'
  | 'CHANNEL_CREATED'
  | 'CHANNEL_UPDATED'
  | 'VOICE_JOIN'
  | 'VOICE_LEAVE'
  | 'VOICE_UPDATE'
  | 'VOICE_SPEAKING'
  | 'SERVER_UPDATE'
  | 'DM_REQUEST_SENT'
  | 'DM_REQUEST_ACCEPTED'
  | 'DM_REQUEST_REJECTED'
  | 'USER_UPDATED';

interface EventPayload {
  type: EventType;
  data: any;
  senderId: string;
}

class EventBus {
  private channel: BroadcastChannel | null = null;
  private listeners: Set<(payload: EventPayload) => void> = new Set();
  public readonly clientId: string;

  constructor() {
    this.clientId =
      typeof window !== 'undefined'
        ? (globalThis.crypto?.randomUUID?.() ?? `client-${Math.random().toString(16).slice(2)}`)
        : 'server';
    if (typeof window !== 'undefined') {
      this.channel = new BroadcastChannel('diavlocord-events');
      this.channel.onmessage = (event) => {
        this.notify(event.data);
      };
    }
  }

  subscribe(callback: (payload: EventPayload) => void) {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  }

  emit(type: EventType, data: any, senderId: string = this.clientId) {
    const payload: EventPayload = { type, data, senderId };
    this.notify(payload);
    this.channel?.postMessage(payload);
  }

  private notify(payload: EventPayload) {
    this.listeners.forEach(callback => callback(payload));
  }
}

export const eventBus = new EventBus();
