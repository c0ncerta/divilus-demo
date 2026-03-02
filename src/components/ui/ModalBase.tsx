'use client';

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';

type ModalBaseProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  ariaLabel?: string;
  closeOnEscape?: boolean;
  closeOnOverlayClick?: boolean;
  restoreFocus?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  rootClassName?: string;
  overlayClassName?: string;
  containerClassName?: string;
  panelClassName?: string;
  rootStyle?: React.CSSProperties;
  overlayStyle?: React.CSSProperties;
  containerStyle?: React.CSSProperties;
  panelStyle?: React.CSSProperties;
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusableElements = (element: HTMLElement): HTMLElement[] =>
  Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (candidate) => !candidate.hasAttribute('disabled') && candidate.getAttribute('aria-hidden') !== 'true'
  );

export const ModalBase = ({
  open,
  onClose,
  children,
  ariaLabelledBy,
  ariaDescribedBy,
  ariaLabel,
  closeOnEscape = true,
  closeOnOverlayClick = true,
  restoreFocus = true,
  initialFocusRef,
  rootClassName,
  overlayClassName,
  containerClassName,
  panelClassName,
  rootStyle,
  overlayStyle,
  containerStyle,
  panelStyle,
}: ModalBaseProps) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

    const focusInitialElement = () => {
      const preferred = initialFocusRef?.current;
      if (preferred && typeof preferred.focus === 'function') {
        preferred.focus();
        return;
      }
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = getFocusableElements(panel);
      if (focusable.length > 0) {
        focusable[0].focus();
        return;
      }
      panel.focus();
    };

    const focusTimer = window.setTimeout(focusInitialElement, 20);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!panelRef.current) return;

      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(panelRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      body.style.overflow = previousOverflow;

      if (restoreFocus && previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === 'function') {
        previousActiveElementRef.current.focus();
      }
    };
  }, [open, onClose, closeOnEscape, restoreFocus, initialFocusRef]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className={cn('fixed inset-0 z-[700]', rootClassName)} style={rootStyle}>
      <button
        type="button"
        aria-label="Cerrar modal"
        onClick={closeOnOverlayClick ? onClose : undefined}
        className={cn('absolute inset-0 bg-black/70 backdrop-blur-md', overlayClassName)}
        style={overlayStyle}
      />
      <div className={cn('absolute inset-0 flex items-center justify-center p-4', containerClassName)} style={containerStyle}>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-label={ariaLabel}
          tabIndex={-1}
          className={cn('pointer-events-auto', panelClassName)}
          style={panelStyle}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};
