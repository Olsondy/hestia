/** Render quality tiers. Interactive phones use `medium`; background stills always use `ultra`. */
export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';
export const qualityTiers: readonly QualityTier[] = ['low', 'medium', 'high', 'ultra'];

export type QualitySettings = {
  /** Upper bound for devicePixelRatio. */
  pixelRatio: number;
  /** Sun shadow map size; 0 disables shadows. */
  shadowMapSize: number;
  /** PCF filter radius in shadow texels (soft edge). */
  shadowRadius: number;
  /** Screen-space ambient occlusion (GTAO) through the post-processing chain. */
  ambientOcclusion: boolean;
  /** Multisampling of the post-processing target (WebGL2). */
  samples: number;
  /** Bloom on lamps and bright highlights. */
  bloom: boolean;
  /** Maximum interior lamps lit as real lights at night; the rest only glow. */
  interiorLights: number;
};

const settings: Record<QualityTier, QualitySettings> = {
  low: { pixelRatio: 1, shadowMapSize: 0, shadowRadius: 0, ambientOcclusion: false, samples: 0, bloom: false, interiorLights: 4 },
  medium: { pixelRatio: 1.5, shadowMapSize: 1024, shadowRadius: 2, ambientOcclusion: false, samples: 0, bloom: false, interiorLights: 8 },
  high: { pixelRatio: 2, shadowMapSize: 2048, shadowRadius: 3, ambientOcclusion: true, samples: 4, bloom: false, interiorLights: 12 },
  ultra: { pixelRatio: 2, shadowMapSize: 4096, shadowRadius: 4, ambientOcclusion: true, samples: 4, bloom: true, interiorLights: 24 },
};
export function qualitySettings(tier: QualityTier): QualitySettings { return { ...settings[tier] }; }

/** Phones and coarse-pointer tablets start at `medium`; desktops at `high`. */
export function detectQuality(): QualityTier {
  if (typeof window === 'undefined') return 'ultra';
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse || Math.min(screen.width, screen.height) < 600 ? 'medium' : 'high';
}
