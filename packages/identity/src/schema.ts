// Better Auth's Drizzle adapter looks tables up by model name; the definitions live in the shared schema.
export {
  hestiaAuthUser as user, hestiaAuthSession as session, hestiaAuthAccount as account,
  hestiaAuthVerification as verification, hestiaInvitation as invitation,
} from '../../persistence/src/schema/identity';
