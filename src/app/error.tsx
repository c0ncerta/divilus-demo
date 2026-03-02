'use client';

import { useEffect } from 'react';

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error('[app:error]', error);
  }, [error]);

  return (
    <div className="min-h-screen w-full bg-[#050506] text-white flex items-center justify-center px-6">
      <div className="w-full max-w-xl rounded-3xl border border-neon-pink/35 bg-[#0B0C10]/90 backdrop-blur-xl p-8 shadow-[0_0_40px_rgba(194,24,60,0.22)]">
        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-neon-pink mb-3">DiavloCord Runtime Guard</div>
        <h1 className="text-3xl font-black tracking-tight mb-3">Se produjo un error en la app</h1>
        <p className="text-[#B5BAC1] text-sm leading-relaxed mb-6">
          La interfaz detecto un fallo y quedo en modo seguro. Puedes reintentar sin cerrar sesion.
        </p>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 mb-6">
          <p className="text-[11px] font-mono text-[#949BA4] break-all">
            {error?.message || 'Error desconocido'}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => reset()}
            className="px-5 py-2.5 rounded-xl bg-neon-blue/15 border border-neon-blue/35 text-neon-blue font-black uppercase tracking-widest text-xs hover:bg-neon-blue/25 transition-all"
          >
            Reintentar
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-xl bg-white/[0.05] border border-white/15 text-white font-black uppercase tracking-widest text-xs hover:bg-white/[0.08] transition-all"
          >
            Recargar pagina
          </button>
        </div>
      </div>
    </div>
  );
}
