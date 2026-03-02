import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ModalBase } from '../ui/ModalBase';

type CropShape = 'circle' | 'rounded';

interface ImageCropModalProps {
  isOpen: boolean;
  imageSrc: string;
  title: string;
  aspect: number;
  shape?: CropShape;
  outputWidth?: number;
  outputHeight?: number;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}

type Point = { x: number; y: number };
type Size = { width: number; height: number };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const ImageCropModal = ({
  isOpen,
  imageSrc,
  title,
  aspect,
  shape = 'rounded',
  outputWidth,
  outputHeight,
  onCancel,
  onConfirm,
}: ImageCropModalProps) => {
  const [mounted, setMounted] = useState(false);
  const [naturalSize, setNaturalSize] = useState<Size>({ width: 0, height: 0 });
  const [frameSize, setFrameSize] = useState<Size>({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; startOffset: Point } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen || !imageSrc) return;
    const img = new Image();
    img.onload = () => {
      setNaturalSize({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
      setOffset({ x: 0, y: 0 });
    };
    img.src = imageSrc;
  }, [isOpen, imageSrc]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = frameRef.current;
    if (!frame) return;
    const updateFrameSize = () => {
      const rect = frame.getBoundingClientRect();
      setFrameSize({ width: rect.width, height: rect.height });
    };
    updateFrameSize();
    const ro = new ResizeObserver(updateFrameSize);
    ro.observe(frame);
    window.addEventListener('resize', updateFrameSize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateFrameSize);
    };
  }, [isOpen, aspect]);

  const minScale = useMemo(() => {
    if (!naturalSize.width || !naturalSize.height || !frameSize.width || !frameSize.height) return 1;
    return Math.max(frameSize.width / naturalSize.width, frameSize.height / naturalSize.height);
  }, [naturalSize, frameSize]);

  const maxScale = useMemo(() => {
    return Math.max(minScale * 4, minScale + 1);
  }, [minScale]);

  const clampOffset = (candidate: Point, targetScale: number) => {
    if (!frameSize.width || !frameSize.height || !naturalSize.width || !naturalSize.height) return candidate;
    const renderedWidth = naturalSize.width * targetScale;
    const renderedHeight = naturalSize.height * targetScale;
    const maxX = Math.max(0, (renderedWidth - frameSize.width) / 2);
    const maxY = Math.max(0, (renderedHeight - frameSize.height) / 2);
    return {
      x: clamp(candidate.x, -maxX, maxX),
      y: clamp(candidate.y, -maxY, maxY),
    };
  };

  useEffect(() => {
    if (!isOpen) return;
    setScale((prev) => clamp(prev || minScale, minScale, maxScale));
  }, [isOpen, minScale, maxScale]);

  useEffect(() => {
    setOffset((prev) => clampOffset(prev, scale));
  }, [scale, frameSize, naturalSize]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      startOffset: offset,
    };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const deltaX = event.clientX - dragStartRef.current.pointerX;
    const deltaY = event.clientY - dragStartRef.current.pointerY;
    const nextOffset = {
      x: dragStartRef.current.startOffset.x + deltaX,
      y: dragStartRef.current.startOffset.y + deltaY,
    };
    setOffset(clampOffset(nextOffset, scale));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    }
    dragStartRef.current = null;
    setDragging(false);
  };

  const onReset = () => {
    setScale(minScale);
    setOffset({ x: 0, y: 0 });
  };

  const onSave = () => {
    if (!imageSrc || !naturalSize.width || !naturalSize.height || !frameSize.width || !frameSize.height) return;
    const targetWidth = outputWidth || Math.round(frameSize.width * 2);
    const targetHeight = outputHeight || Math.round(frameSize.height * 2);
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const renderedWidth = naturalSize.width * scale;
    const renderedHeight = naturalSize.height * scale;
    const imageLeft = frameSize.width / 2 - renderedWidth / 2 + offset.x;
    const imageTop = frameSize.height / 2 - renderedHeight / 2 + offset.y;
    const scaleX = targetWidth / frameSize.width;
    const scaleY = targetHeight / frameSize.height;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(
        img,
        imageLeft * scaleX,
        imageTop * scaleY,
        renderedWidth * scaleX,
        renderedHeight * scaleY
      );
      const MAX_BYTES_ESTIMATE = 1_900_000;
      let quality = 0.88;
      let output = canvas.toDataURL('image/webp', quality);

      // Fallback for browsers without webp export support.
      if (!output.startsWith('data:image/webp')) {
        output = canvas.toDataURL('image/jpeg', quality);
      }

      // Keep payload bounded to avoid API/localStorage overflows on big banners.
      while (output.length > MAX_BYTES_ESTIMATE && quality > 0.58) {
        quality = Number((quality - 0.08).toFixed(2));
        output = canvas.toDataURL('image/jpeg', quality);
      }

      onConfirm(output);
    };
    img.src = imageSrc;
  };

  const zoomPercent = Math.round((scale / minScale) * 100);
  const maxZoomPercent = Math.max(220, Math.round((maxScale / minScale) * 100));
  const renderedWidth = naturalSize.width * scale;
  const renderedHeight = naturalSize.height * scale;
  const imageLeft = frameSize.width / 2 - renderedWidth / 2 + offset.x;
  const imageTop = frameSize.height / 2 - renderedHeight / 2 + offset.y;

  if (!mounted || !isOpen) return null;

  return (
    <ModalBase
      open={mounted && isOpen}
      onClose={onCancel}
      ariaLabelledBy="image-crop-modal-title"
      ariaDescribedBy="image-crop-modal-description"
      rootClassName="z-[360]"
      overlayClassName="bg-black/70 backdrop-blur-sm"
      panelClassName="relative w-full max-w-4xl rounded-2xl border border-[#B83A50]/35 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(150,20,42,0.25),rgba(8,8,12,0.95)_55%)] shadow-[0_30px_120px_rgba(0,0,0,0.65)] overflow-hidden"
      closeOnOverlayClick
    >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <div id="image-crop-modal-title" className="text-white font-black text-lg">{title}</div>
            <div id="image-crop-modal-description" className="text-[#9ca3af] text-xs uppercase tracking-[0.2em]">Drag and zoom to fit</div>
          </div>
          <button
            onClick={onCancel}
            className="w-9 h-9 rounded-full border border-white/15 bg-black/30 text-[#B5BAC1] hover:text-white hover:border-white/30 transition-all"
            aria-label="Close crop editor"
          >
            <X size={16} className="mx-auto" />
          </button>
        </div>

        <div className="p-5 sm:p-6">
          <div className="mx-auto max-w-3xl">
            <div className="relative rounded-2xl border border-white/10 bg-black/45 p-4 sm:p-5">
              <div
                ref={frameRef}
                className={cn(
                  'relative w-full overflow-hidden border border-white/15 bg-[#0B0C10] touch-none',
                  shape === 'circle' ? 'rounded-full mx-auto max-w-[420px]' : 'rounded-2xl'
                )}
                style={{ aspectRatio: `${aspect}` }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                {imageSrc ? (
                  <img
                    src={imageSrc}
                    alt="Crop preview"
                    draggable={false}
                    className={cn('absolute select-none pointer-events-none max-w-none', dragging ? 'cursor-grabbing' : 'cursor-grab')}
                    style={{
                      width: `${renderedWidth}px`,
                      height: `${renderedHeight}px`,
                      left: `${imageLeft}px`,
                      top: `${imageTop}px`,
                    }}
                  />
                ) : null}
                <div className="absolute inset-0 border border-white/20 pointer-events-none" />
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-[#9ca3af]">Zoom</div>
                <div className="text-sm text-white font-semibold">{zoomPercent}%</div>
              </div>
              <input
                type="range"
                min={100}
                max={maxZoomPercent}
                value={zoomPercent}
                onChange={(event) => {
                  const ratio = Number(event.target.value) / 100;
                  const nextScale = clamp(minScale * ratio, minScale, maxScale);
                  setScale(nextScale);
                }}
                className="w-full accent-[#C2183C]"
              />
              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  onClick={onReset}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 bg-black/20 text-[#DBDEE1] hover:bg-white/10 transition-all"
                >
                  <RotateCcw size={16} />
                  Reset
                </button>
                <button
                  onClick={onSave}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl border border-[#39ff14]/40 bg-[linear-gradient(180deg,rgba(31,99,38,0.35),rgba(18,52,26,0.45))] text-[#DAFFE0] font-black shadow-[0_0_24px_rgba(57,255,20,0.24)] hover:shadow-[0_0_32px_rgba(57,255,20,0.36)] transition-all"
                >
                  <Check size={16} />
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
    </ModalBase>
  );
};
