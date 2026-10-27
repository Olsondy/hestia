import { z } from 'zod';

const id = z.string().min(1).max(120);
export const catalogSizeSchema = z.object({ width: z.number().finite().positive().max(20), height: z.number().finite().positive().max(20), depth: z.number().finite().positive().max(20) }).strict();
export const catalogReferenceSchema = z.object({ assetId: id, assetVersion: z.number().int().positive(), materialId: id, materialVersion: z.number().int().positive() }).strict();
export type CatalogSize = z.infer<typeof catalogSizeSchema>;
export type CatalogReference = z.infer<typeof catalogReferenceSchema>;
export type CatalogAsset = {
  id: string; version: number; name: string; category: 'sofa' | 'table' | 'chair' | 'desk' | 'bed';
  defaultSize: CatalogSize;
  sizeRange: Record<keyof CatalogSize, { min: number; max: number; step: number }>;
  materialIds: string[]; defaultMaterialId: string;
  source: { kind: 'builtin-prototype'; path: string; itemId: string; dimensionBasis: 'synthetic-template'; note: string };
};
export type CatalogMaterial = { id: string; version: number; name: string; swatch: string; colors: Record<string, string>; source: { path: string; styleId: string } };
export type CatalogView = { version: number; assets: CatalogAsset[]; materials: CatalogMaterial[] };
