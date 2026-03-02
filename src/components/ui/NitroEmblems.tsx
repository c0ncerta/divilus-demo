import React, { useId } from 'react';
import { cn } from '../../lib/utils';

interface NitroEmblemsProps {
  className?: string;
  size?: number;
  compact?: boolean;
}

const Coin = ({ className, children, size }: { className?: string; children: React.ReactNode; size: number }) => (
  <span
    className={cn(
      'inline-flex items-center justify-center rounded-full border border-white/20 shadow-[0_0_14px_rgba(122,16,39,0.18)]',
      className
    )}
    style={{ width: size + 4, height: size + 4 }}
  >
    {children}
  </span>
);

export const NitroEmblems = ({ className, size = 14, compact = false }: NitroEmblemsProps) => {
  const gradId = useId().replace(/:/g, '');
  const nitroGrad = `nitroGrad-${gradId}`;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] backdrop-blur-md',
        compact ? 'px-1.5 py-1' : 'px-2 py-1',
        className
      )}
      aria-label="Nitro emblems"
      title="Nitro emblems"
    >
      <Coin
        size={size}
        className="bg-[radial-gradient(circle_at_30%_20%,rgba(103,255,237,0.95),rgba(13,125,129,0.85)_75%)] text-[#051314] font-black"
      >
        <span className="text-[9px] leading-none">#</span>
      </Coin>

      <Coin size={size} className="bg-[linear-gradient(135deg,#7A1027,#8E1330)]">
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M7.5 5.75C6.395 5.75 5.5 6.645 5.5 7.75V16.25C5.5 17.355 6.395 18.25 7.5 18.25H16.5C17.605 18.25 18.5 17.355 18.5 16.25V7.75C18.5 6.645 17.605 5.75 16.5 5.75H7.5Z"
            fill={`url(#${nitroGrad})`}
          />
          <path
            d="M10.25 8.75H12.2L13.75 11.25L15.25 8.75H17.25L14.75 12L17.25 15.25H15.3L13.75 12.8L12.2 15.25H10.2L12.75 12L10.25 8.75Z"
            fill="#0A0A0B"
            opacity="0.9"
          />
          <defs>
            <linearGradient id={nitroGrad} x1="5.5" y1="5.75" x2="18.5" y2="18.25" gradientUnits="userSpaceOnUse">
              <stop stopColor="#A41437" />
              <stop offset="1" stopColor="#7A1027" />
            </linearGradient>
          </defs>
        </svg>
      </Coin>

      <Coin size={size} className="badge-flow bg-[#1B1030]">
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M12 3.5c3.7 0 6.5 2.8 6.5 6.5 0 4.6-4 6.7-6.5 10.5C9.5 16.7 5.5 14.6 5.5 10 5.5 6.3 8.3 3.5 12 3.5Z"
            fill="#0A0A0B"
            opacity="0.85"
          />
          <path
            d="M9.4 10.1c0-1.3 1-2.4 2.3-2.4 1.2 0 2.3 1 2.3 2.3 0 1.8-1.6 2.8-2.3 3.9-.7-1.1-2.3-2.1-2.3-3.8Z"
            fill="#FFFFFF"
            opacity="0.85"
          />
        </svg>
      </Coin>
    </span>
  );
};
