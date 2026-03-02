import { NextResponse } from 'next/server';
import { isMediaGenerationAllowedForUser } from '@/lib/media-generation-access';

export const runtime = 'nodejs';

type GenerationMode = 'image' | 'video';
type ImageGenerationProvider = 'auto' | 'wavespeed' | 'civitai';
type VideoQuality = 'low' | 'standard' | 'ultra';

type CivitaiModelVersion = {
  id?: number;
  baseModel?: string;
};

type CivitaiModelPayload = {
  id?: number;
  type?: string;
  modelVersions?: CivitaiModelVersion[];
};

const DEFAULT_WAVESPEED_BASE_URL = 'https://api.wavespeed.ai/api/v3';
const DEFAULT_SD35_ENDPOINT = 'stability-ai/stable-diffusion-3.5-large';
const DEFAULT_WAN22_ENDPOINT = 'wavespeed-ai/wan-2.2/i2v-720p-ultra-fast';

const DEFAULT_CIVITAI_MODEL_URL = 'https://civitai.com/models/277058/epicrealism-xl';
const DEFAULT_CIVITAI_ORCHESTRATION_URL = 'https://orchestration.civitai.com';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const safeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const parseEnvNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isDemoMode = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.NEXT_PUBLIC_DEMO || '').trim().toLowerCase()
);

const normalizeUrl = (value: string, fallback: string) => {
  const next = String(value || '').trim();
  if (!next) return fallback;
  return next.replace(/\/+$/, '');
};

const normalizeEndpoint = (value: string, fallback: string) => {
  const next = String(value || '').trim();
  if (!next) return fallback;
  return next.replace(/^\/+/, '').replace(/\/+$/, '');
};

const parseImageGenerationProvider = (value: string): ImageGenerationProvider => {
  const next = safeText(value).toLowerCase();
  if (next === 'civitai') return 'civitai';
  if (next === 'wavespeed') return 'wavespeed';
  return 'auto';
};

const parseVideoQuality = (value: string): VideoQuality => {
  const next = safeText(value).toLowerCase();
  if (next === 'low') return 'low';
  if (next === 'standard' || next === 'medium') return 'standard';
  return 'ultra';
};

const uniqueStrings = (items: string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const value = safeText(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
};

const buildWavespeedImageEndpointCandidates = (primaryEndpoint: string) => {
  const primary = normalizeEndpoint(primaryEndpoint, DEFAULT_SD35_ENDPOINT);
  const fixedPrefix =
    primary.startsWith('wavespeed-ai/stable-diffusion-3.5')
      ? primary.replace(/^wavespeed-ai\//, 'stability-ai/')
      : '';
  return uniqueStrings([
    primary,
    fixedPrefix,
    'stability-ai/stable-diffusion-3.5-large',
    'stability-ai/stable-diffusion-3.5-large-turbo',
  ]);
};

const isRetryableWavespeedImageSubmitError = (rawMessage: string) => {
  const raw = safeText(rawMessage).toLowerCase();
  if (!raw.startsWith('wavespeed_submit_failed:')) return false;
  return !(
    raw.includes('status_401') ||
    raw.includes('status_402') ||
    raw.includes('status_403') ||
    raw.includes('status_429') ||
    raw.includes('unauthorized') ||
    raw.includes('forbidden') ||
    raw.includes('rate limit') ||
    raw.includes('credit') ||
    raw.includes('quota') ||
    raw.includes('insufficient') ||
    raw.includes('payment')
  );
};

const isCivitaiBuzzRelatedError = (rawMessage: string) => {
  const raw = safeText(rawMessage).toLowerCase();
  if (!raw.startsWith('civitai_submit_failed:')) return false;
  return (
    raw.includes('buzz') ||
    raw.includes('credit') ||
    raw.includes('insufficient') ||
    raw.includes('payment_required') ||
    raw.includes('status_402')
  );
};

const isUrlLike = (value: string) => /^https?:\/\//i.test(value) || /^data:/i.test(value);

const pickUrl = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const next = value.trim();
    return next && isUrlLike(next) ? next : null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = pickUrl(entry);
      if (resolved) return resolved;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return (
      pickUrl(record.url) ||
      pickUrl(record.uri) ||
      pickUrl(record.src) ||
      pickUrl(record.output) ||
      pickUrl(record.outputs) ||
      pickUrl(record.blobUrl) ||
      null
    );
  }

  return null;
};

const pickStatus = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const data = record.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : null;
  const raw = safeText(data?.status || record.status);
  return raw.toLowerCase();
};

const isCompletedStatus = (status: string) =>
  status === 'completed' || status === 'succeeded' || status === 'success' || status === 'done';

const isFailedStatus = (status: string) =>
  status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled';

const pickTaskId = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const data = record.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : null;
  const id = safeText(data?.id || record.id || data?.task_id || record.task_id);
  return id || null;
};

const pickOutputUrl = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const data = record.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : null;
  return (
    pickUrl(data?.outputs) ||
    pickUrl(data?.output) ||
    pickUrl(data?.result) ||
    pickUrl(record.outputs) ||
    pickUrl(record.output) ||
    pickUrl(record.result) ||
    null
  );
};

const pickCivitaiBlobUrl = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const jobs = Array.isArray(record.jobs) ? (record.jobs as unknown[]) : [];
  for (const job of jobs) {
    if (!job || typeof job !== 'object') continue;
    const result = (job as Record<string, unknown>).result;
    const blobUrl = pickUrl(result);
    if (blobUrl) return blobUrl;
  }
  return null;
};

const toDataUrl = async (file: File) => {
  const mime = safeText(file.type) || 'image/png';
  const buffer = Buffer.from(await file.arrayBuffer());
  return `data:${mime};base64,${buffer.toString('base64')}`;
};

const readErrorBody = async (response: Response) => {
  try {
    const payload = (await response.json()) as Record<string, unknown>;
    const data = payload?.data && typeof payload.data === 'object' ? (payload.data as Record<string, unknown>) : null;
    return (
      safeText(payload?.message || data?.message || payload?.error || data?.error) ||
      safeText(payload?.reason) ||
      `status_${response.status}`
    );
  } catch {
    return `status_${response.status}`;
  }
};

const parseCivitaiModelId = (modelRef: string): string | null => {
  const raw = safeText(modelRef);
  if (!raw) return null;

  const plain = raw.match(/^\d+$/);
  if (plain?.[0]) return plain[0];

  const pathMatch = raw.match(/\/models\/(\d+)/i);
  if (pathMatch?.[1]) return pathMatch[1];

  try {
    const parsed = new URL(raw);
    const directPathMatch = parsed.pathname.match(/\/models\/(\d+)/i);
    if (directPathMatch?.[1]) return directPathMatch[1];
    const qp = parsed.searchParams.get('modelId');
    if (qp && /^\d+$/.test(qp)) return qp;
  } catch {}

  return null;
};

const toCivitaiAssetType = (modelType: string) => {
  const lower = modelType.toLowerCase();
  if (lower.includes('checkpoint')) return 'checkpoint';
  if (lower.includes('locon')) return 'locon';
  if (lower.includes('lora')) return 'lora';
  if (lower.includes('textual')) return 'textualinversion';
  if (lower.includes('lycoris')) return 'lycoris';
  return 'checkpoint';
};

const toCivitaiFamily = (baseModel: string) => {
  const lower = baseModel.toLowerCase();
  if (lower.includes('sdxl')) return 'sdxl';
  if (lower.includes('sd 1') || lower.includes('sd1') || lower.includes('sd_1')) return 'sd1';
  if (lower.includes('flux')) return 'flux1';
  return 'sdxl';
};

const toCivitaiBaseModel = (family: string) => {
  if (family === 'sd1') return 'SD_1_5';
  if (family === 'flux1') return 'FLUX';
  return 'SDXL';
};

const POLL_TIMEOUT_MS = clamp(parseEnvNumber(process.env.GENERATION_POLL_TIMEOUT_MS, 180_000), 20_000, 420_000);
const POLL_INTERVAL_MS = clamp(parseEnvNumber(process.env.GENERATION_POLL_INTERVAL_MS, 2_500), 700, 25_000);
const MAX_IMAGE_UPLOAD_BYTES = 16 * 1024 * 1024;

const callWavespeed = async (input: {
  apiBaseUrl: string;
  apiKey: string;
  endpoint: string;
  body: Record<string, unknown>;
  mode: GenerationMode;
}) => {
  const { apiBaseUrl, apiKey, endpoint, body, mode } = input;
  const submitUrl = /^https?:\/\//i.test(endpoint)
    ? endpoint
    : `${apiBaseUrl}/${normalizeEndpoint(endpoint, '')}`;

  const submitResponse = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!submitResponse.ok) {
    const upstream = await readErrorBody(submitResponse);
    throw new Error(`wavespeed_submit_failed:${upstream}`);
  }

  const submitPayload = (await submitResponse.json().catch(() => ({}))) as Record<string, unknown>;
  const immediateUrl = pickOutputUrl(submitPayload);
  if (immediateUrl) {
    return {
      resultUrl: immediateUrl,
      taskId: pickTaskId(submitPayload),
      filename: `diavlocord-${mode}-${Date.now()}.${mode === 'video' ? 'mp4' : 'png'}`,
    };
  }

  const taskId = pickTaskId(submitPayload);
  if (!taskId) {
    throw new Error('wavespeed_missing_task_id');
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    const pollResponse = await fetch(`${apiBaseUrl}/predictions/${encodeURIComponent(taskId)}/result`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: 'no-store',
    });

    if (!pollResponse.ok) continue;

    const pollPayload = (await pollResponse.json().catch(() => ({}))) as Record<string, unknown>;
    const status = pickStatus(pollPayload);
    const outputUrl = pickOutputUrl(pollPayload);

    if (outputUrl) {
      return {
        resultUrl: outputUrl,
        taskId,
        filename: `diavlocord-${mode}-${taskId}.${mode === 'video' ? 'mp4' : 'png'}`,
      };
    }

    if (isCompletedStatus(status)) {
      throw new Error('wavespeed_completed_without_output');
    }
    if (isFailedStatus(status)) {
      const reason = safeText((pollPayload.data as Record<string, unknown> | undefined)?.message || pollPayload.message);
      throw new Error(`wavespeed_prediction_failed:${reason || 'unknown'}`);
    }
  }

  throw new Error('wavespeed_prediction_timeout');
};

const callCivitaiImageGeneration = async (input: { apiToken: string; prompt: string }) => {
  const modelRef = safeText(process.env.CIVITAI_IMAGE_MODEL_URL) || DEFAULT_CIVITAI_MODEL_URL;
  const modelId = parseCivitaiModelId(modelRef);
  if (!modelId) {
    throw new Error('civitai_invalid_model_url');
  }

  const modelRes = await fetch(`https://civitai.com/api/v1/models/${encodeURIComponent(modelId)}`, { cache: 'no-store' });
  if (!modelRes.ok) {
    const reason = await readErrorBody(modelRes);
    throw new Error(`civitai_model_fetch_failed:${reason}`);
  }

  const modelPayload = (await modelRes.json().catch(() => null)) as CivitaiModelPayload | null;
  if (!modelPayload) throw new Error('civitai_model_invalid_response');

  const versions = Array.isArray(modelPayload.modelVersions) ? modelPayload.modelVersions : [];
  if (versions.length === 0) throw new Error('civitai_model_no_versions');

  const requestedVersionId = safeText(process.env.CIVITAI_IMAGE_MODEL_VERSION_ID);
  const chosenVersion =
    (requestedVersionId
      ? versions.find((version) => String(version?.id || '') === requestedVersionId)
      : null) || versions[0];

  const versionId = String(chosenVersion?.id || '').trim();
  if (!versionId) throw new Error('civitai_model_version_missing');

  const modelType = safeText(modelPayload.type) || 'Checkpoint';
  const assetType = toCivitaiAssetType(modelType);
  const family = toCivitaiFamily(safeText(chosenVersion?.baseModel));
  const modelUrn = `urn:air:${family}:${assetType}:civitai:${modelId}@${versionId}`;

  const width = clamp(parseEnvNumber(process.env.CIVITAI_IMAGE_WIDTH, 1024), 256, 1024);
  const height = clamp(parseEnvNumber(process.env.CIVITAI_IMAGE_HEIGHT, 1024), 256, 1024);
  const steps = clamp(parseEnvNumber(process.env.CIVITAI_IMAGE_STEPS, 26), 8, 80);
  const cfgScale = clamp(parseEnvNumber(process.env.CIVITAI_IMAGE_CFG, 5), 1, 20);
  const scheduler = safeText(process.env.CIVITAI_IMAGE_SCHEDULER) || 'EulerA';
  const negativePrompt = safeText(process.env.CIVITAI_IMAGE_NEGATIVE_PROMPT);

  const orchestrationUrl = normalizeUrl(
    process.env.CIVITAI_ORCHESTRATION_URL || '',
    DEFAULT_CIVITAI_ORCHESTRATION_URL
  );

  const submitBody: Record<string, unknown> = {
    $type: 'textToImage',
    baseModel: toCivitaiBaseModel(family),
    model: modelUrn,
    params: {
      prompt: input.prompt,
      scheduler,
      steps,
      cfgScale,
      width,
      height,
      seed: -1,
      clipSkip: 1,
      ...(negativePrompt ? { negativePrompt } : {}),
    },
  };

  const submitResponse = await fetch(`${orchestrationUrl}/v1/consumer/jobs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(submitBody),
    cache: 'no-store',
  });

  if (!submitResponse.ok) {
    const reason = await readErrorBody(submitResponse);
    throw new Error(`civitai_submit_failed:${reason}`);
  }

  const submitPayload = (await submitResponse.json().catch(() => ({}))) as Record<string, unknown>;
  const token = safeText(submitPayload.token);
  if (!token) throw new Error('civitai_missing_token');

  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    const pollResponse = await fetch(
      `${orchestrationUrl}/v1/consumer/jobs?token=${encodeURIComponent(token)}&wait=false`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${input.apiToken}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      }
    );

    if (!pollResponse.ok) continue;
    const pollPayload = (await pollResponse.json().catch(() => ({}))) as Record<string, unknown>;
    const blobUrl = pickCivitaiBlobUrl(pollPayload);
    if (blobUrl) {
      return {
        resultUrl: blobUrl,
        filename: `diavlocord-image-civitai-${modelId}-${versionId}.png`,
        modelUrn,
      };
    }
  }

  throw new Error('civitai_generation_timeout');
};

export async function POST(request: Request) {
  if (isDemoMode) {
    return NextResponse.json({ error: 'disabled_in_demo_mode' }, { status: 403 });
  }

  const requesterUserId = safeText(request.headers.get('x-diavlocord-user-id'));
  if (!isMediaGenerationAllowedForUser(requesterUserId)) {
    return NextResponse.json({ error: 'forbidden_user' }, { status: 403 });
  }

  const wavespeedApiKey = safeText(process.env.WAVESPEED_API_KEY);
  const civitaiApiToken = safeText(process.env.CIVITAI_API_TOKEN);

  const wavespeedBaseUrl = normalizeUrl(process.env.WAVESPEED_API_BASE_URL || '', DEFAULT_WAVESPEED_BASE_URL);
  const sd35Endpoint = normalizeEndpoint(process.env.WAVESPEED_SD35_ENDPOINT || '', DEFAULT_SD35_ENDPOINT);
  const wanEndpoint = normalizeEndpoint(process.env.WAN22_WORKFLOW_ENDPOINT || '', DEFAULT_WAN22_ENDPOINT);
  const wanEndpointLow = normalizeEndpoint(process.env.WAN22_WORKFLOW_ENDPOINT_LOW || '', wanEndpoint);
  const wanEndpointStandard = normalizeEndpoint(process.env.WAN22_WORKFLOW_ENDPOINT_STANDARD || '', wanEndpoint);
  const wanEndpointUltra = normalizeEndpoint(process.env.WAN22_WORKFLOW_ENDPOINT_ULTRA || '', wanEndpoint);

  const imageProvider = parseImageGenerationProvider(process.env.IMAGE_GENERATION_PROVIDER || 'auto');

  try {
    const formData = await request.formData();
    const rawMode = safeText(formData.get('mode'));
    const mode: GenerationMode = rawMode === 'video' ? 'video' : 'image';
    const prompt = safeText(formData.get('prompt'));
    const videoDurationRaw = Number.parseInt(safeText(formData.get('videoDurationSec')), 10);
    const videoDurationSec = Number.isFinite(videoDurationRaw) ? clamp(videoDurationRaw, 2, 20) : 5;
    const videoQuality = parseVideoQuality(safeText(formData.get('videoQuality')));
    if (prompt.length < 2) {
      return NextResponse.json({ error: 'invalid_prompt' }, { status: 400 });
    }

    const imageEntry = formData.get('image');
    const imageFile = imageEntry instanceof File ? imageEntry : null;
    if (imageFile && imageFile.size > MAX_IMAGE_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'image_too_large' }, { status: 413 });
    }

    const imageDataUrl = imageFile ? await toDataUrl(imageFile) : null;

    if (mode === 'video') {
      if (!imageDataUrl) {
        return NextResponse.json({ error: 'image_required_for_video' }, { status: 400 });
      }
      if (!wavespeedApiKey) {
        return NextResponse.json({ error: 'missing_wavespeed_key' }, { status: 500 });
      }

      const selectedWanEndpoint =
        videoQuality === 'low'
          ? wanEndpointLow
          : videoQuality === 'standard'
            ? wanEndpointStandard
            : wanEndpointUltra;

      const bodyWithHints: Record<string, unknown> = {
        prompt,
        image: imageDataUrl,
        enable_base64_output: false,
        duration: videoDurationSec,
        seconds: videoDurationSec,
        num_frames: clamp(videoDurationSec * 16, 24, 320),
        fps: 16,
        quality: videoQuality,
      };

      const minimalBody: Record<string, unknown> = {
        prompt,
        image: imageDataUrl,
        enable_base64_output: false,
      };

      let generated;
      try {
        generated = await callWavespeed({
          apiBaseUrl: wavespeedBaseUrl,
          apiKey: wavespeedApiKey,
          endpoint: selectedWanEndpoint,
          body: bodyWithHints,
          mode: 'video',
        });
      } catch (error) {
        const raw = error instanceof Error ? error.message : '';
        if (!raw.startsWith('wavespeed_submit_failed:')) {
          throw error;
        }
        generated = await callWavespeed({
          apiBaseUrl: wavespeedBaseUrl,
          apiKey: wavespeedApiKey,
          endpoint: selectedWanEndpoint,
          body: minimalBody,
          mode: 'video',
        });
      }

      return NextResponse.json({
        ok: true,
        provider: 'wavespeed',
        model: selectedWanEndpoint,
        mediaType: 'video',
        resultUrl: generated.resultUrl,
        filename: generated.filename,
        taskId: generated.taskId,
        durationSec: videoDurationSec,
        quality: videoQuality,
      });
    }

    const generateImageWithWavespeed = async () => {
      if (!wavespeedApiKey) {
        throw new Error('missing_wavespeed_key');
      }
      const endpoints = buildWavespeedImageEndpointCandidates(sd35Endpoint);
      const bodies: Record<string, unknown>[] = [];
      if (imageDataUrl) {
        bodies.push({
          prompt,
          image: imageDataUrl,
          enable_base64_output: false,
        });
      }
      bodies.push({
        prompt,
        enable_base64_output: false,
      });

      let lastRetryableError: Error | null = null;
      for (const endpoint of endpoints) {
        for (const body of bodies) {
          try {
            const generated = await callWavespeed({
              apiBaseUrl: wavespeedBaseUrl,
              apiKey: wavespeedApiKey,
              endpoint,
              body,
              mode: 'image',
            });
            return {
              ...generated,
              endpoint,
            };
          } catch (error) {
            const raw = error instanceof Error ? error.message : '';
            if (!isRetryableWavespeedImageSubmitError(raw)) {
              throw error;
            }
            lastRetryableError =
              error instanceof Error ? error : new Error('wavespeed_submit_failed:unknown');
          }
        }
      }

      throw lastRetryableError || new Error('wavespeed_submit_failed:unknown');
    };

    const shouldUseCivitai =
      imageProvider === 'civitai' || (imageProvider === 'auto' && Boolean(civitaiApiToken));

    if (shouldUseCivitai) {
      if (!civitaiApiToken) {
        return NextResponse.json({ error: 'missing_civitai_token' }, { status: 500 });
      }
      try {
        const generated = await callCivitaiImageGeneration({
          apiToken: civitaiApiToken,
          prompt,
        });
        return NextResponse.json({
          ok: true,
          provider: 'civitai',
          model: generated.modelUrn,
          mediaType: 'image',
          resultUrl: generated.resultUrl,
          filename: generated.filename,
        });
      } catch (error) {
        const raw = error instanceof Error ? error.message : '';
        if (!isCivitaiBuzzRelatedError(raw)) throw error;
        const fallbackGenerated = await generateImageWithWavespeed();
        return NextResponse.json({
          ok: true,
          provider: 'wavespeed',
          mediaType: 'image',
          model: fallbackGenerated.endpoint,
          resultUrl: fallbackGenerated.resultUrl,
          filename: fallbackGenerated.filename,
          taskId: fallbackGenerated.taskId,
          fallbackFrom: 'civitai_buzz',
        });
      }
    }

    const generated = await generateImageWithWavespeed();

    return NextResponse.json({
      ok: true,
      provider: 'wavespeed',
      model: generated.endpoint,
      mediaType: 'image',
      resultUrl: generated.resultUrl,
      filename: generated.filename,
      taskId: generated.taskId,
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : 'generation_failed';
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
