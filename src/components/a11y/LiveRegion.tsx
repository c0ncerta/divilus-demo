'use client';

import { useEffect, useRef, useState } from 'react';
import { subscribeAnnouncements } from '../../lib/a11y/announcer';

export const LiveRegion = () => {
  const [politeMessage, setPoliteMessage] = useState('');
  const [assertiveMessage, setAssertiveMessage] = useState('');
  const timersRef = useRef<{
    politeSet: number | null;
    polite: number | null;
    assertiveSet: number | null;
    assertive: number | null;
  }>({
    politeSet: null,
    polite: null,
    assertiveSet: null,
    assertive: null,
  });

  useEffect(() => {
    const clearTimer = (timerId: number | null) => {
      if (timerId != null) window.clearTimeout(timerId);
    };

    const queueAnnouncement = (priority: 'polite' | 'assertive', message: string) => {
      if (priority === 'assertive') {
        clearTimer(timersRef.current.assertiveSet);
        clearTimer(timersRef.current.assertive);
        setAssertiveMessage('');
        timersRef.current.assertiveSet = window.setTimeout(() => {
          setAssertiveMessage(message);
          timersRef.current.assertive = window.setTimeout(() => setAssertiveMessage(''), 1200);
        }, 20);
        return;
      }

      clearTimer(timersRef.current.politeSet);
      clearTimer(timersRef.current.polite);
      setPoliteMessage('');
      timersRef.current.politeSet = window.setTimeout(() => {
        setPoliteMessage(message);
        timersRef.current.polite = window.setTimeout(() => setPoliteMessage(''), 1200);
      }, 20);
    };

    const unsubscribe = subscribeAnnouncements((payload) => {
      queueAnnouncement(payload.priority, payload.message);
    });

    return () => {
      unsubscribe();
      clearTimer(timersRef.current.politeSet);
      clearTimer(timersRef.current.polite);
      clearTimer(timersRef.current.assertiveSet);
      clearTimer(timersRef.current.assertive);
    };
  }, []);

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true" role="status">
        {politeMessage}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true" role="alert">
        {assertiveMessage}
      </div>
    </>
  );
};
