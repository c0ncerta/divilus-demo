export type AnnouncementPriority = 'polite' | 'assertive';

export type AnnouncementOptions = {
  priority?: AnnouncementPriority;
  dedupeKey?: string;
  minIntervalMs?: number;
};

type AnnouncementPayload = {
  id: number;
  message: string;
  priority: AnnouncementPriority;
};

type AnnouncementListener = (payload: AnnouncementPayload) => void;

const listeners = new Set<AnnouncementListener>();
const dedupeTimestamps = new Map<string, number>();
let announcementCounter = 0;

export const subscribeAnnouncements = (listener: AnnouncementListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const announce = (message: string, options?: AnnouncementOptions) => {
  const trimmed = String(message || '').trim();
  if (!trimmed) return;

  const priority = options?.priority === 'assertive' ? 'assertive' : 'polite';
  const dedupeKey = options?.dedupeKey?.trim();
  const minIntervalMs = Math.max(0, options?.minIntervalMs ?? 1400);

  if (dedupeKey) {
    const now = Date.now();
    const previous = dedupeTimestamps.get(dedupeKey) || 0;
    if (now - previous < minIntervalMs) return;
    dedupeTimestamps.set(dedupeKey, now);
  }

  announcementCounter += 1;
  const payload: AnnouncementPayload = {
    id: announcementCounter,
    message: trimmed,
    priority,
  };

  listeners.forEach((listener) => listener(payload));
};

