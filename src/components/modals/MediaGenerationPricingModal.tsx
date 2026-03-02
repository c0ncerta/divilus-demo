import React, { useEffect, useState } from 'react';
import { Crown, Gem, ShieldCheck, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ModalBase } from '../ui/ModalBase';

type Props = {
  open: boolean;
  onClose: () => void;
};

const PAYPAL_CHECKOUT_URL = 'https://www.paypal.com/ncp/payment/N7C55VWJV4NDQ';

const plans = [
  {
    id: 'standard',
    title: 'Plan Standard',
    price: '5 EUR',
    quota: '+50 fotos o +5 videos',
    quality: 'Calidad mas baja',
    icon: ShieldCheck,
    accent: 'border-white/18 bg-white/[0.03] text-white',
  },
  {
    id: 'ultra',
    title: 'Plan Ultra',
    price: '10 EUR',
    quota: '+50 fotos o +5 videos',
    quality: 'Calidad ultra',
    icon: Gem,
    accent: 'border-neon-blue/45 bg-neon-blue/12 text-neon-blue',
  },
  {
    id: 'pro',
    title: 'Plan Pro',
    price: '20 EUR',
    quota: '+100 fotos o +10 videos',
    quality: 'Calidad ultra',
    icon: Crown,
    accent: 'border-amber-300/45 bg-amber-300/12 text-amber-200',
  },
];

export const MediaGenerationPricingModal = ({ open, onClose }: Props) => {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  const handlePayClick = () => {
    if (typeof window === 'undefined') return;
    const newWindow = window.open(PAYPAL_CHECKOUT_URL, '_blank', 'noopener,noreferrer');
    if (!newWindow) {
      window.location.href = PAYPAL_CHECKOUT_URL;
    }
    onClose();
  };

  useEffect(() => {
    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (open) {
      setMounted(true);
      rafId = requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
      timeoutId = setTimeout(() => setMounted(false), 220);
    }

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <ModalBase
      open={mounted}
      onClose={onClose}
      ariaLabelledBy="pricing-modal-title"
      ariaDescribedBy="pricing-modal-description"
      rootClassName="z-[880]"
      overlayClassName={cn(
        'bg-black/76 backdrop-blur-md transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0'
      )}
      panelClassName={cn(
        'relative w-full max-w-[760px] rounded-2xl border border-white/10 bg-[#090B11]/95 p-4 sm:p-5 shadow-[0_30px_90px_rgba(0,0,0,0.62)] transition-all duration-250',
        visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-[0.97] translate-y-2 pointer-events-none'
      )}
    >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/48">Pago Requerido</div>
            <h3 id="pricing-modal-title" className="mt-1 text-xl font-black text-white">Activa Generacion</h3>
            <p id="pricing-modal-description" className="mt-1 text-xs text-white/62">
              Para generar contenido necesitas uno de estos planes.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/12 bg-white/[0.03] text-white/72 hover:bg-white/[0.08] hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {plans.map((plan) => {
            const Icon = plan.icon;
            return (
              <div key={plan.id} className={cn('rounded-xl border p-4', plan.accent)}>
                <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-current/30 bg-black/15">
                  <Icon size={17} />
                </div>
                <div className="text-sm font-black uppercase tracking-[0.14em]">{plan.title}</div>
                <div className="mt-2 text-xl font-black">{plan.price}</div>
                <div className="mt-2 text-xs font-semibold text-white/88">{plan.quota}</div>
                <div className="mt-1 text-[11px] text-white/72">{plan.quality}</div>
                <button
                  type="button"
                  onClick={handlePayClick}
                  className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg border border-current/40 bg-black/20 text-[11px] font-black uppercase tracking-[0.12em] hover:bg-black/30"
                >
                  Pagar
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-white/68">
          Pulsa Pagar y se abrira PayPal para completar el pago.
        </div>
    </ModalBase>
  );
};
