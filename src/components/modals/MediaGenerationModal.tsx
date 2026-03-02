import React, { useEffect, useRef, useState } from 'react';
import { Download, Image as ImageIcon, Loader2, Sparkles, Video, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useStore } from '../../lib/store';
import { isMediaGenerationAllowedForUser } from '../../lib/media-generation-access';
import { MediaGenerationPricingModal } from './MediaGenerationPricingModal';
import { ModalBase } from '../ui/ModalBase';

type GenerationMode = 'image' | 'video';
type GenerationMediaType = 'image' | 'video';
type VideoQuality = 'low' | 'standard' | 'ultra';

type GenerationResult = {
  url: string;
  filename: string;
  mediaType: GenerationMediaType;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

const extensionForType = (type: GenerationMediaType) => (type === 'video' ? 'mp4' : 'png');

const fallbackFilename = (mode: GenerationMode, mediaType: GenerationMediaType) =>
  `diavlocord-${mode}-${Date.now()}.${extensionForType(mediaType)}`;

const resolveGenerationErrorMessage = (rawError: string): string => {
  const raw = (rawError || '').trim();
  if (!raw) return 'No se pudo generar. Revisa API key, endpoint o prompt e intenta otra vez.';

  if (raw === 'missing_wavespeed_key') {
    return 'Falta configurar WAVESPEED_API_KEY en Vercel (entorno Production).';
  }
  if (raw === 'missing_civitai_token') {
    return 'Falta configurar CIVITAI_API_TOKEN en Vercel (entorno Production).';
  }
  if (raw === 'forbidden_user') {
    return 'No tienes permiso para generar con esta cuenta.';
  }
  if (raw === 'invalid_prompt') {
    return 'El prompt es demasiado corto. Escribe una descripcion mas clara.';
  }
  if (raw === 'image_required_for_video') {
    return 'Para video necesitas subir una imagen.';
  }
  if (raw === 'image_too_large') {
    return 'La imagen es demasiado pesada. Usa una menor de 16MB.';
  }

  if (raw.startsWith('civitai_invalid_model_url')) {
    return 'CIVITAI_IMAGE_MODEL_URL no es valido.';
  }
  if (raw.startsWith('civitai_model_no_versions') || raw.startsWith('civitai_model_version_missing')) {
    return 'El modelo de Civitai no tiene version valida para generar.';
  }
  if (raw.startsWith('civitai_model_fetch_failed:')) {
    if (raw.includes('status_401') || raw.includes('status_403')) {
      return 'Civitai rechazo el acceso al modelo. Revisa token/permisos.';
    }
    if (raw.includes('status_429')) {
      return 'Civitai esta limitando peticiones. Intenta en unos minutos.';
    }
    return 'No se pudo leer el modelo en Civitai. Revisa CIVITAI_IMAGE_MODEL_URL.';
  }
  if (raw.startsWith('civitai_submit_failed:')) {
    const detail = raw.split(':').slice(1).join(':').toLowerCase();
    if (detail.includes('buzz') || detail.includes('credit') || detail.includes('insufficient')) {
      return 'No tienes creditos (Buzz) suficientes en Civitai para generar.';
    }
    if (detail.includes('unauthorized') || detail.includes('forbidden') || detail.includes('status_401') || detail.includes('status_403')) {
      return 'Token de Civitai invalido o sin permisos.';
    }
    if (detail.includes('status_429')) {
      return 'Civitai esta limitando peticiones. Intenta de nuevo mas tarde.';
    }
    return 'Civitai rechazo la generacion. Revisa token, creditos y modelo.';
  }
  if (raw.startsWith('civitai_missing_token')) {
    return 'Civitai no devolvio token de trabajo. Intenta otra vez.';
  }
  if (raw.startsWith('civitai_generation_timeout')) {
    return 'Civitai tardo demasiado en responder. Intenta de nuevo.';
  }

  if (raw.startsWith('wavespeed_submit_failed:')) {
    if (raw.includes('status_401') || raw.includes('status_403')) {
      return 'Wavespeed API key invalida o sin permisos.';
    }
    if (raw.includes('status_402')) {
      return 'Wavespeed rechazo por creditos/saldo. Recarga tu cuenta y prueba otra vez.';
    }
    if (raw.includes('status_404')) {
      return 'El endpoint de Wavespeed no existe. Revisa WAVESPEED_SD35_ENDPOINT.';
    }
    if (raw.includes('status_429')) {
      return 'Wavespeed esta limitando peticiones. Intenta en unos minutos.';
    }
    return 'Wavespeed rechazo la generacion. Revisa endpoint, key o parametros.';
  }
  if (raw.startsWith('wavespeed_prediction_timeout')) {
    return 'La generacion en Wavespeed excedio el tiempo limite.';
  }
  if (raw.startsWith('wavespeed_prediction_failed:')) {
    return 'Wavespeed no pudo completar la generacion con ese prompt/imagen.';
  }
  if (raw.startsWith('wavespeed_missing_task_id') || raw.startsWith('wavespeed_completed_without_output')) {
    return 'Wavespeed devolvio una respuesta incompleta. Intenta otra vez.';
  }

  return 'No se pudo generar. Revisa API key, endpoint o prompt e intenta otra vez.';
};

export const MediaGenerationModal = ({ open, onClose }: Props) => {
  const currentUserId = useStore((state) => state.currentUser.id);
  const canCurrentUserGenerate = isMediaGenerationAllowedForUser(currentUserId);
  const [mode, setMode] = useState<GenerationMode>('image');
  const [prompt, setPrompt] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [videoDurationSec, setVideoDurationSec] = useState<number>(5);
  const [videoQuality, setVideoQuality] = useState<VideoQuality>('ultra');
  const [inputPreviewUrl, setInputPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!imageFile) {
      setInputPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(imageFile);
    setInputPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [imageFile]);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => promptRef.current?.focus(), 80);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (open) {
      setMounted(true);
      rafId = requestAnimationFrame(() => setVisible(true));
      return () => {
        if (rafId != null) cancelAnimationFrame(rafId);
      };
    }
    setVisible(false);
    timeoutId = setTimeout(() => setMounted(false), 240);
    return () => {
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    setPrompt('');
    setImageFile(null);
    setVideoDurationSec(5);
    setVideoQuality('ultra');
    setResult(null);
    setPricingOpen(false);
    setError('');
    setIsGenerating(false);
    setIsDownloading(false);
  }, [open]);

  const handleGenerate = async () => {
    if (!canCurrentUserGenerate) {
      setPricingOpen(true);
      return;
    }

    const safePrompt = prompt.trim();
    if (safePrompt.length < 2) {
      setError('Escribe un prompt mas claro.');
      return;
    }
    if (mode === 'video' && !imageFile) {
      setError('Para video necesitas subir una imagen de referencia.');
      return;
    }

    const formData = new FormData();
    formData.set('mode', mode);
    formData.set('prompt', safePrompt);
    if (imageFile) {
      formData.set('image', imageFile);
    }
    if (mode === 'video') {
      formData.set('videoDurationSec', String(videoDurationSec));
      formData.set('videoQuality', videoQuality);
    }

    setError('');
    setIsGenerating(true);
    setResult(null);

    try {
      const response = await fetch('/api/media/generate', {
        method: 'POST',
        headers: {
          'x-diavlocord-user-id': currentUserId,
        },
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            resultUrl?: string;
            mediaType?: string;
            filename?: string;
            error?: string;
          }
        | null;
      if (!response.ok || !payload?.resultUrl) {
        throw new Error(payload?.error || 'generation_failed');
      }

      const mediaType: GenerationMediaType = payload.mediaType === 'video' ? 'video' : 'image';
      setResult({
        url: payload.resultUrl,
        mediaType,
        filename: payload.filename || fallbackFilename(mode, mediaType),
      });
    } catch (generationError) {
      const raw = generationError instanceof Error ? generationError.message : 'generation_failed';
      if (raw === 'forbidden_user') {
        setPricingOpen(true);
      } else {
        setError(resolveGenerationErrorMessage(raw));
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = async () => {
    if (!result || isDownloading) return;
    setIsDownloading(true);
    setError('');
    try {
      const response = await fetch(result.url, { cache: 'no-store' });
      if (!response.ok) throw new Error('download_failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1200);
      return;
    } catch {}

    const fallback = document.createElement('a');
    fallback.href = result.url;
    fallback.download = result.filename;
    fallback.target = '_blank';
    fallback.rel = 'noopener noreferrer';
    document.body.appendChild(fallback);
    fallback.click();
    fallback.remove();
    setIsDownloading(false);
  };

  useEffect(() => {
    if (!isDownloading) return;
    const id = setTimeout(() => setIsDownloading(false), 1200);
    return () => clearTimeout(id);
  }, [isDownloading]);

  if (!mounted) return null;

  const isVideoMode = mode === 'video';
  const canGenerate =
    !isGenerating &&
    (!canCurrentUserGenerate ||
      (prompt.trim().length >= 2 && (!isVideoMode || Boolean(imageFile))));

  return (
    <ModalBase
      open={mounted}
      onClose={onClose}
      ariaLabelledBy="media-generation-modal-title"
      ariaDescribedBy="media-generation-modal-description"
      rootClassName="z-[760]"
      overlayClassName={cn(
        'bg-black/72 backdrop-blur-md transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0'
      )}
      panelClassName={cn(
        'relative w-full max-w-[980px] rounded-2xl border border-white/10 bg-[#08090D]/92 shadow-[0_25px_90px_rgba(0,0,0,0.6)] transition-all duration-300',
        'grid gap-4 p-4 sm:p-5 lg:grid-cols-12',
        visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-[0.97] translate-y-2 pointer-events-none'
      )}
      initialFocusRef={promptRef}
    >
        <div className="lg:col-span-7 rounded-2xl border border-white/10 bg-[#0D0F16]/85 p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/45">Gen Lab</div>
              <h3 id="media-generation-modal-title" className="mt-1 text-lg font-black text-white">Generador Imagen y Video</h3>
              <p id="media-generation-modal-description" className="mt-1 text-xs text-white/55">
                Foto: epiCRealism XL (Civitai). Video: WAN 2.2 workflow compatible.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/12 bg-white/[0.03] text-white/70 hover:bg-white/[0.08] hover:text-white"
            >
              <X size={16} />
            </button>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('image')}
              className={cn(
                'h-10 rounded-xl border text-xs font-black uppercase tracking-[0.14em] transition-colors inline-flex items-center justify-center gap-2',
                mode === 'image'
                  ? 'border-neon-blue/50 bg-neon-blue/16 text-neon-blue'
                  : 'border-white/10 bg-white/[0.02] text-white/70 hover:text-white'
              )}
            >
              <ImageIcon size={14} />
              Foto
            </button>
            <button
              type="button"
              onClick={() => setMode('video')}
              className={cn(
                'h-10 rounded-xl border text-xs font-black uppercase tracking-[0.14em] transition-colors inline-flex items-center justify-center gap-2',
                mode === 'video'
                  ? 'border-neon-blue/50 bg-neon-blue/16 text-neon-blue'
                  : 'border-white/10 bg-white/[0.02] text-white/70 hover:text-white'
              )}
            >
              <Video size={14} />
              Video
            </button>
          </div>

          <div className="mb-3">
            <label htmlFor="media-generation-image-input" className="text-[11px] font-black uppercase tracking-[0.14em] text-white/58">
              1. Imagen
            </label>
            <label htmlFor="media-generation-image-input" className="mt-2 flex min-h-[86px] cursor-pointer items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-3 py-3 text-center text-xs text-white/60 transition-colors hover:border-white/35 hover:text-white">
              <input
                id="media-generation-image-input"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const next = event.target.files?.[0] || null;
                  setImageFile(next);
                  setError('');
                }}
              />
              {imageFile
                ? `Archivo: ${imageFile.name}`
                : isVideoMode
                  ? 'Sube una imagen para I2V'
                  : 'Sube una imagen opcional de referencia'}
            </label>
          </div>

          <div className="mb-4">
            <label htmlFor="media-generation-prompt" className="text-[11px] font-black uppercase tracking-[0.14em] text-white/58">
              2. Prompt
            </label>
            <textarea
              id="media-generation-prompt"
              ref={promptRef}
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                if (error) setError('');
              }}
              placeholder={
                isVideoMode
                  ? 'Describe movimiento, camara, estilo y ambiente...'
                  : 'Describe la imagen que quieres generar...'
              }
              className="mt-2 h-32 w-full resize-none rounded-xl border border-white/12 bg-[#090B11] px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:border-neon-blue/55"
            />
          </div>

          {isVideoMode ? (
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="media-generation-duration" className="text-[11px] font-black uppercase tracking-[0.14em] text-white/58">
                  3. Duracion
                </label>
                <select
                  id="media-generation-duration"
                  value={String(videoDurationSec)}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    setVideoDurationSec(Number.isFinite(parsed) ? parsed : 5);
                  }}
                  className="mt-2 h-11 w-full rounded-xl border border-white/12 bg-[#090B11] px-3 text-sm text-white outline-none transition-colors focus:border-neon-blue/55"
                >
                  <option value="3">3 segundos</option>
                  <option value="5">5 segundos</option>
                  <option value="8">8 segundos</option>
                  <option value="10">10 segundos</option>
                  <option value="15">15 segundos</option>
                  <option value="20">20 segundos</option>
                </select>
              </div>

              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-white/58">4. Calidad</p>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {(['low', 'standard', 'ultra'] as const).map((quality) => (
                    <button
                      key={quality}
                      type="button"
                      onClick={() => setVideoQuality(quality)}
                      className={cn(
                        'h-11 rounded-lg border text-[10px] font-black uppercase tracking-[0.12em] transition-colors',
                        videoQuality === quality
                          ? 'border-neon-blue/50 bg-neon-blue/14 text-neon-blue'
                          : 'border-white/12 bg-white/[0.02] text-white/70 hover:text-white'
                      )}
                    >
                      {quality === 'low' ? 'Baja' : quality === 'standard' ? 'Media' : 'Ultra'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="mb-3 rounded-lg border border-neon-pink/45 bg-neon-pink/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-neon-pink">
              {error}
            </div>
          ) : null}

          {!canCurrentUserGenerate ? (
            <div className="mb-3 rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-amber-200">
              Acceso restringido. Pulsa generar para ver planes de pago.
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className={cn(
                'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-xs font-black uppercase tracking-[0.14em] transition-colors',
                canGenerate
                  ? 'bg-[#7A1027] text-white hover:bg-[#5D0D1E]'
                  : 'cursor-not-allowed bg-white/[0.05] text-white/35'
              )}
            >
              {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {isGenerating ? 'Generando...' : canCurrentUserGenerate ? 'Generar' : 'Ver planes'}
            </button>

            {result ? (
              <button
                type="button"
                onClick={handleDownload}
                disabled={isDownloading}
                className={cn(
                  'inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-black uppercase tracking-[0.14em] transition-colors',
                  isDownloading
                    ? 'border-neon-blue/45 bg-neon-blue/12 text-neon-blue'
                    : 'border-neon-green/45 bg-neon-green/12 text-neon-green hover:bg-neon-green/18'
                )}
              >
                {isDownloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Descargar
              </button>
            ) : null}
          </div>
        </div>

        <div className="lg:col-span-5 rounded-2xl border border-white/10 bg-[#0A0C12]/90 p-4">
          <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/52">Preview</div>
          <div className="relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#06070B]">
            {result ? (
              result.mediaType === 'video' ? (
                <video src={result.url} className="h-full w-full object-contain" controls playsInline>
                  <track kind="captions" label="Captions unavailable" />
                </video>
              ) : (
                <img src={result.url} alt="Resultado generado" className="h-full w-full object-contain" />
              )
            ) : inputPreviewUrl ? (
              <div className="h-full w-full">
                <img src={inputPreviewUrl} alt="Referencia subida" className="h-full w-full object-contain opacity-75" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-8 text-[11px] text-white/70">
                  Referencia cargada. Genera para ver el resultado final aqui.
                </div>
              </div>
            ) : (
              <div className="px-6 text-center text-xs text-white/45">
                El preview final aparece en este panel cuando termine la generacion.
              </div>
            )}
          </div>
        </div>
      <MediaGenerationPricingModal
        open={pricingOpen}
        onClose={() => setPricingOpen(false)}
      />
    </ModalBase>
  );
};
