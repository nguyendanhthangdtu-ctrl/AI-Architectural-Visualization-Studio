import type { AuthenticatedUser, SessionRepository, UserRepository } from '@avs/project-core';

/**
 * BUILD 19 Phase 2 (Identity/Auth Hardening) — the clean provider boundary
 * between "how a session/credential is verified" and everything else
 * (`requireAuth()`, every route). This formalizes what `requireAuth()`
 * already did inline in RELEASE 02 into an explicit, swappable interface —
 * not a new architecture, the existing one named. A production managed
 * identity provider (Auth0/Clerk/Cognito/etc.) plugs in by implementing this
 * same interface (e.g. verifying a provider-issued JWT instead of looking up
 * a local session row) and wiring it into `AppContext.identityProvider` —
 * no other file needs to change. No vendor is chosen here (CLAUDE.md rule 7
 * — never fabricate an integration with no real account behind it).
 */
export interface IdentityProvider {
  /** Resolves an opaque credential (this app's session cookie value) to the real user it belongs to — `null` if invalid/expired/revoked. Never trusts a client-asserted identity. */
  verifySession(sessionId: string): Promise<AuthenticatedUser | null>;
}

/**
 * The concrete dev/production-capable implementation backing this app today
 * — real, revocable, server-side sessions (`SessionRepository`), not a
 * placeholder. "Local" names what it verifies against (this app's own
 * database), not a claim about production-readiness.
 */
export function createLocalIdentityProvider(deps: {
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
}): IdentityProvider {
  return {
    async verifySession(sessionId: string): Promise<AuthenticatedUser | null> {
      const session = await deps.sessionRepository.getById(sessionId);
      if (!session) return null;

      if (new Date(session.expiresAt).getTime() < Date.now()) {
        await deps.sessionRepository.deleteById(sessionId);
        return null;
      }

      const user = await deps.userRepository.getById(session.userId);
      return user ? { id: user.id, email: user.email } : null;
    },
  };
}
