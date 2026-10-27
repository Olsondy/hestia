import { DomainError } from '../../../../../../packages/contracts/src/project';
import { acceptInvitation, acceptInvitationSchema, InvitationError } from '../../../../../../packages/identity/src/service';
import { body, endpoint, sameOrigin } from '../../../../lib/server';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  return endpoint(async () => {
    sameOrigin(request);
    const input = acceptInvitationSchema.parse(await body(request));
    try {
      const accepted = await acceptInvitation(input.token, input.name, input.password);
      return { ok: true, email: accepted.email };
    } catch (error) {
      if (error instanceof InvitationError)
        throw new DomainError(error.code, '邀请无效、已过期或已使用。已有账号请直接登录。');
      throw error;
    }
  });
}
