// ComfyUI graphs the studio queues. The H3 graph follows the Ark engine's photorealistic setting
// (photoreal/lib/h3.mjs): two reference-to-video conditionings, with and without the guide video,
// over one schedule split at `keep`, so a Blender greybox fixes layout, camera and timing for the
// first steps and H3 draws everything after. Character sheets and the look ride along as reference
// images on every take; a start frame (the previous take's last frame) and an optional end frame
// are anchored with MiniMaxH3AddGuide, which gives the first+last-frame bridges.

export const H3 = { width: 960, height: 544, fps: 24, minFrames: 5, maxFrames: 362 };
export const h3Len = (seconds: number) => {
  const n = Math.round(seconds * H3.fps);
  return Math.min(H3.maxFrames, Math.max(5, 17 * Math.ceil((n - 5) / 17) + 5));
};

export const STYLE_REFERENCE = 'The provided image condition is a visual style reference. '
  + 'Transfer its color palette, lighting, texture, material treatment, rendering medium, '
  + "and overall aesthetic to the generated video. Do not copy the image's exact composition, "
  + "object identity, pose, or spatial layout; follow the main prompt for content and action.";
export const CHARACTER_REFERENCE = 'Reference images after the first show the characters in this shot. '
  + 'Keep each face, build, hair and costume exactly as in their reference.';

export interface H3Params {
  prompt: string;
  frames: number;
  seed: number;
  steps?: number;            // 20
  keep?: number;             // steps steered by the guide video (5)
  guideVideo?: string | null; // uploaded greybox clip
  look?: string | null;       // uploaded look image
  characters?: string[];      // uploaded character sheets
  startFrame?: string | null; // uploaded image anchored at frame 0
  endFrame?: string | null;   // uploaded image anchored at the last frame
  width?: number;
  height?: number;
  prefix: string;
}

export function h3Graph(p: H3Params) {
  const steps = p.steps ?? 20, keep = p.keep ?? 5;
  const width = p.width ?? H3.width, height = p.height ?? H3.height;
  const refs: string[] = [];
  const g: Record<string, any> = {
    1: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', type: 'minimax', device: 'default' } },
    2: { class_type: 'UNETLoader', inputs: { unet_name: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors', weight_dtype: 'default' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_video_vae_fp16.safetensors' } },
    4: { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_audio_vae_fp32.safetensors' } },
    5: { class_type: 'MiniMaxH3SigmaShift', inputs: { model: ['2', 0], shift_video: 12, shift_audio: 3 } },
  };
  if (p.look) { g[30] = { class_type: 'LoadImage', inputs: { image: p.look } }; refs.push('30'); }
  (p.characters ?? []).slice(0, 8).forEach((c, i) => { g[31 + i] = { class_type: 'LoadImage', inputs: { image: c } }; refs.push(String(31 + i)); });
  let prompt = p.prompt;
  if (p.look) prompt += `\n\nstyle_reference_guidance: ${STYLE_REFERENCE}`;
  if (p.characters?.length) prompt += `\n\ncharacter_reference_guidance: ${CHARACTER_REFERENCE}`;

  const cond = (withGuide: boolean) => ({
    class_type: 'MiniMaxH3ReferenceToVideo',
    inputs: {
      clip: ['1', 0], vae: ['3', 0], audio_vae: ['4', 0], prompt, width, height, length: p.frames, ref_image_size: 'match',
      ...Object.fromEntries(refs.map((n, i) => [`ref_images.ref_image_${i + 1}`, [n, 0]])),
      ...(withGuide ? { 'ref_videos.ref_video_1': ['21', 0] } : {}),
    },
  });
  g[16] = cond(false);
  g[8] = { class_type: 'RandomNoise', inputs: { noise_seed: p.seed } };
  g[18] = { class_type: 'DisableNoise', inputs: {} };
  g[9] = { class_type: 'BasicScheduler', inputs: { model: ['5', 0], scheduler: 'simple', steps, denoise: 1 } };
  g[10] = { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } };

  // anchors: the start frame at 0 and the end frame at -1, on each conditioning
  const anchor = (positive: [string, number], latent: [string, number], base: number): [string, number] => {
    let pos = positive;
    if (p.startFrame) {
      g[base] = { class_type: 'LoadImage', inputs: { image: p.startFrame } };
      g[base + 1] = { class_type: 'MiniMaxH3AddGuide', inputs: { positive: pos, vae: ['3', 0], latent, image: [String(base), 0], frame_idx: 0 } };
      pos = [String(base + 1), 0];
    }
    if (p.endFrame) {
      g[base + 2] = { class_type: 'LoadImage', inputs: { image: p.endFrame } };
      g[base + 3] = { class_type: 'MiniMaxH3AddGuide', inputs: { positive: pos, vae: ['3', 0], latent, image: [String(base + 2), 0], frame_idx: -1 } };
      pos = [String(base + 3), 0];
    }
    return pos;
  };

  if (p.guideVideo) {
    g[20] = { class_type: 'LoadVideo', inputs: { file: p.guideVideo } };
    g[21] = { class_type: 'GetVideoComponents', inputs: { video: ['20', 0] } };
    g[6] = cond(true);
    g[7] = { class_type: 'BasicGuider', inputs: { model: ['5', 0], conditioning: anchor(['6', 0], ['6', 1], 50) } };
    g[17] = { class_type: 'BasicGuider', inputs: { model: ['5', 0], conditioning: anchor(['16', 0], ['6', 1], 60) } };
    g[19] = { class_type: 'SplitSigmas', inputs: { sigmas: ['9', 0], step: keep } };
    g[11] = { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['8', 0], guider: ['7', 0], sampler: ['10', 0], sigmas: ['19', 0], latent_image: ['6', 1] } };
    g[22] = { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['18', 0], guider: ['17', 0], sampler: ['10', 0], sigmas: ['19', 1], latent_image: ['11', 0] } };
  } else {
    g[17] = { class_type: 'BasicGuider', inputs: { model: ['5', 0], conditioning: anchor(['16', 0], ['16', 1], 60) } };
    g[22] = { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['8', 0], guider: ['17', 0], sampler: ['10', 0], sigmas: ['9', 0], latent_image: ['16', 1] } };
  }
  g[12] = { class_type: 'VAEDecode', inputs: { samples: ['22', 0], vae: ['3', 0] } };
  g[14] = { class_type: 'CreateVideo', inputs: { images: ['12', 0], fps: H3.fps, bit_depth: 8 } };
  g[15] = { class_type: 'SaveVideo', inputs: { video: ['14', 0], filename_prefix: p.prefix, format: 'auto', codec: 'auto' } };
  return g;
}

// Stills (storyboard frames, character sheets, looks): Qwen-Image 2.1, as the engine's image command uses.
// `refs` are uploaded images the text encoder sees (a hand sketch to follow, for one).
export function imageGraph({ prompt, negative = 'text, watermark, logo, blurry, deformed, extra fingers', seed, width = 1344, height = 768, steps = 20, prefix, refs = [] }: { prompt: string; negative?: string; seed: number; width?: number; height?: number; steps?: number; prefix: string; refs?: string[] }) {
  const g: Record<string, any> = {
    1: { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_w4a8_heretic.safetensors', type: 'qwen_image', device: 'default' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    4: { class_type: 'TextEncodeQwenImage21', inputs: { clip: ['2', 0], prompt, negative_prompt: negative, resolution: 1024, ...(refs.length ? { vae: ['3', 0] } : {}), ...Object.fromEntries(refs.map((_, i) => [`images.image_${i + 1}`, [String(20 + i), 0]])) } },
    6: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    7: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['4', 0], negative: ['4', 1], latent_image: ['6', 0], seed, steps, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple', denoise: 1.0 } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    9: { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: prefix } },
  };
  refs.forEach((r, i) => { g[20 + i] = { class_type: 'LoadImage', inputs: { image: r } }; });
  return g;
}

export const ASPECTS: Record<string, [number, number]> = {
  '16:9': [1344, 768], '9:16': [768, 1344], '1:1': [1024, 1024], '2.39:1': [1536, 640],
};
