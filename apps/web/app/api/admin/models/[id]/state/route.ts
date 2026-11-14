import { z } from 'zod';
import { setModelDisabled } from '../../../../../../../../packages/model-registry/src/service';
import { endpoint } from '../../../../../../lib/server';
import { adminWrite } from '../../../../../../lib/admin';
type Context = { params: Promise<{ id: string }> };
const stateSchema = z.object({ disabled: z.boolean() }).strict();
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: Context) {
  return endpoint(async () => {
    const { admin, input } = await adminWrite(request);
    return { model: await setModelDisabled(admin, (await context.params).id, stateSchema.parse(input).disabled) };
  });
}
