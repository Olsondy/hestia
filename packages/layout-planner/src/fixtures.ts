import { randomUUID } from 'node:crypto';
import type { SpatialState } from '../../contracts/src/project';
import { catalogInstance } from '../../catalog/src/instances';
import { initialBrief } from '../../conversation/src/brief';
import type { PlanInput } from './contract';

/** Synthetic geometry only, reusable at varied dimensions/origins; never a real residence. */
export function syntheticPlanningInput(width = 6, depth = 5, x = 0, z = 0): PlanInput {
  const facts = randomUUID(), reference = { assetId: 'prototype-sofa', assetVersion: 1, materialId: 'prototype-wood', materialVersion: 1 };
  const state: SpatialState = { version: 1, synthetic: true, scale: 'synthetic', fixedFacts: { id: facts, revision: 1,
    rooms: [{ id: 'planning-room', outline: [{ x, z }, { x: x + width, z }, { x: x + width, z: z + depth }, { x, z: z + depth }], floorColor: '#d7c5ae' }],
    walls: [
      { id: 'north', a: { x, z }, b: { x: x + width, z }, thickness: .18, height: 2.7, openings: [] },
      { id: 'south', a: { x, z: z + depth }, b: { x: x + width, z: z + depth }, thickness: .18, height: 2.7, openings: [] },
      { id: 'east', a: { x: x + width, z }, b: { x: x + width, z: z + depth }, thickness: .18, height: 2.7, openings: [] },
      { id: 'west', a: { x, z }, b: { x, z: z + depth }, thickness: .18, height: 2.7, openings: [{ id: 'entry', offset: depth - 1.5, width: 1, sill: 0, head: 2.1 }] },
    ], objects: [], openingClearances: [{ openingId: 'entry', kind: 'none' }] },
    currentLayout: { id: randomUUID(), revision: 1, fixedFactsId: facts, fixedFactsRevision: 1, lockedObjectIds: [],
      objects: [catalogInstance('existing-sofa', reference, { width: 2.2, depth: .95, height: 1.11 }, { x: x + width / 2, z: z + 1.2, yaw: 0 })] } };
  const brief = initialBrief('请为这个房间生成会客和办公布局，保留现有家具');
  return { state, brief, operationId: randomUUID(), decision: { kind: 'propose_layout', roomId: 'planning-room', sourceInputIds: [brief.inputs[0].id], requirementIds: [], functions: ['hosting', 'work'] } };
}
