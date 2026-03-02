"use client";

import React from 'react';
import { X } from 'lucide-react';
import { ModalBase } from '../ui/ModalBase';

export const NitroModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  if (!open) return null;

  let nitroActive = false;
  let expiryLabel = '';
  try {
    const rawExpiry = localStorage.getItem('diavlocord-nitro-expiry');
    if (rawExpiry) {
      const expiryMs = Number(rawExpiry) || new Date(rawExpiry).getTime();
      nitroActive = !Number.isNaN(expiryMs) && expiryMs > Date.now();
      if (nitroActive) {
        const d = new Date(expiryMs);
        expiryLabel = d.toLocaleDateString();
      }
    }
  } catch {}

  const NitroBadge = () => (
    <span className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-gradient-to-tr from-neon-purple/30 to-neon-pink/15 border border-white/10">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M7.5 5.75C6.395 5.75 5.5 6.645 5.5 7.75V16.25C5.5 17.355 6.395 18.25 7.5 18.25H16.5C17.605 18.25 18.5 17.355 18.5 16.25V7.75C18.5 6.645 17.605 5.75 16.5 5.75H7.5Z"
          fill="url(#nitroGradModal)"
        />
        <path
          d="M10.25 8.75H12.2L13.75 11.25L15.25 8.75H17.25L14.75 12L17.25 15.25H15.3L13.75 12.8L12.2 15.25H10.2L12.75 12L10.25 8.75Z"
          fill="#0A0A0B"
          opacity="0.9"
        />
        <defs>
          <linearGradient id="nitroGradModal" x1="5.5" y1="5.75" x2="18.5" y2="18.25" gradientUnits="userSpaceOnUse">
            <stop stopColor="#7A1027" />
            <stop offset="1" stopColor="#8E1330" />
          </linearGradient>
        </defs>
      </svg>
    </span>
  );

  const claimNitro = () => {
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 3); // 3 months
    try {
      localStorage.setItem('diavlocord-nitro-expiry', String(expiry.getTime()));
    } catch (e) {}
    onClose();
    window.location.reload();
  };
  const titleId = 'nitro-modal-title';
  const descriptionId = 'nitro-modal-description';

  return (
    <ModalBase
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      rootClassName="z-[400]"
      overlayClassName="bg-black/60 animate-in fade-in duration-200"
      panelClassName="relative z-50 w-[520px] bg-[#18191C] rounded-2xl border border-white/5 p-6 shadow-2xl popup-boost popup-glow"
    >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 id={titleId} className="text-xl font-bold text-white">Free Nitro</h3>
            <p id={descriptionId} className="text-sm text-[#B5BAC1] mt-1">Recibe 3 meses de Nitro gratuito. Próximamente tendrás emblemas personalizados.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded hover:bg-white/5 text-[#B5BAC1]"><X /></button>
        </div>

        <div className="flex items-center gap-4 mb-4">
          <NitroBadge />
          <div className="min-w-0">
            <div className="text-white font-black">Nitro (3 meses)</div>
            <div className="text-xs text-[#B5BAC1] mt-1">
              {nitroActive ? `Ya reclamado · activo hasta ${expiryLabel}` : 'Oferta limitada · reclama tu prueba gratuita'}
            </div>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-[#0F1112] border border-white/5 mb-4">
          <div className="font-black text-white">Beneficios</div>
          <ul className="text-sm text-[#B5BAC1] mt-2 list-disc list-inside">
            <li>Acceso a Nitro por 3 meses</li>
            <li>Emblemas personalizados (próximamente)</li>
            <li>Mejores reacciones y boosts</li>
          </ul>
        </div>

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-2xl bg-white/[0.03] border border-white/6 text-white">Cancelar</button>
          <button
            onClick={nitroActive ? undefined : claimNitro}
            disabled={nitroActive}
            className={
              nitroActive
                ? 'px-5 py-2 rounded-2xl bg-white/[0.06] border border-white/10 text-white/70 font-black cursor-not-allowed'
                : 'px-5 py-2 rounded-2xl bg-neon-blue text-white font-black'
            }
          >
            {nitroActive ? 'Ya reclamado' : 'Recibir Nitro'}
          </button>
        </div>
    </ModalBase>
  );
};
