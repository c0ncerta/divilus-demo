const ALLOWED_MEDIA_GENERATION_USER_IDS = new Set([
  'cmlxqsbsl000052f0on418q9j',
]);

const normalizeUserId = (value: string | null | undefined) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const isMediaGenerationAllowedForUser = (userId: string | null | undefined): boolean =>
  ALLOWED_MEDIA_GENERATION_USER_IDS.has(normalizeUserId(userId));

export const mediaGenerationOwnerId = 'cmlxqsbsl000052f0on418q9j';
