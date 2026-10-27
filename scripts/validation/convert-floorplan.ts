import { readFile, writeFile } from 'node:fs/promises';
import { convertHouseSpec } from '../../packages/floorplan-import/src/house-spec.ts';

// Diagnostic command only. Never infer confirmed scale from a model/script's own fields.
const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error('Usage: tsx scripts/validation/convert-floorplan.ts input.json output.json');
const source = JSON.parse(await readFile(inputPath, 'utf8'));
const result = convertHouseSpec(source, { sourceId: 'diagnostic-import', sourceFormat: 'housespec-mm-v1', scaleEvidence: { status: 'estimated' } });
await writeFile(outputPath, JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ walls: result.walls.length, openings: result.walls.reduce((n, w) => n + w.openings.length, 0),
  conceptOnly: result.conceptOnly, confirmed: result.confirmed, warnings: result.warnings.map(w => w.code) }));
