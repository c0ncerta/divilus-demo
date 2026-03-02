'use client';

import { useEffect } from 'react';

type GlobalErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalErrorPage({ error, reset }: GlobalErrorPageProps) {
  useEffect(() => {
    console.error('[app:global-error]', error);
  }, [error]);

  return (
    <html lang="es">
      <body className="min-h-screen w-full bg-[#040405] text-white flex items-center justify-center px-6">
        <div className="w-full max-w-2xl rounded-3xl border border-neon-pink/35 bg-[#0B0C10]/92 backdrop-blur-2xl p-10 shadow-[0_0_60px_rgba(194,24,60,0.28)]">
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-neon-pink mb-3">Critical Recovery Mode</div>
          <h1 className="text-4xl font-black tracking-tight mb-3">DiavloCord entro en recuperacion</h1>
          <p className="text-[#B5BAC1] text-sm leading-relaxed mb-6">
            Ocurrio un error global en la interfaz. Puedes reinicializar la app o refrescar completamente.
          </p>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 mb-8">
            <p className="text-[11px] font-mono text-[#949BA4] break-all">
              {error?.message || 'Global error'}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => reset()}
              className="px-5 py-2.5 rounded-xl bg-neon-blue/15 border border-neon-blue/35 text-neon-blue font-black uppercase tracking-widest text-xs hover:bg-neon-blue/25 transition-all"
            >
              Reinicializar UI
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl bg-white/[0.05] border border-white/15 text-white font-black uppercase tracking-widest text-xs hover:bg-white/[0.08] transition-all"
            >
              Recargar completa
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
