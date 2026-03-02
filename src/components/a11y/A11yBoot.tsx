'use client';

import { useEffect } from 'react';
import { useStore } from '../../lib/store';
import { LiveRegion } from './LiveRegion';

const resolveDocumentLang = (language: string) => {
  if (language === 'es') return 'es';
  return 'en';
};

export const A11yBoot = () => {
  const language = useStore((state) => state.language);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = resolveDocumentLang(language);
  }, [language]);

  return <LiveRegion />;
};

