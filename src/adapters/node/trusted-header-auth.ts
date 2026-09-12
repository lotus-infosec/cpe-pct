// TrustedHeaderAuth (self-hosted, optional): a reverse proxy in front has already authenticated the owner
// and sets a header (default Remote-User). Active only when AUTH_MODE=trusted-header. Never enable this
// unless the proxy strips the header from client requests.
import type { Authenticator, Principal } from '../../ports';

export class TrustedHeaderAuth implements Authenticator {
  readonly routes = 'none' as const;
  constructor(private readonly headerName = 'Remote-User') {}
  async authenticate(req: Request): Promise<Principal | null> {
    const v = req.headers.get(this.headerName);
    return v && v.trim() ? { id: 'owner', via: 'trusted-header' } : null;
  }
}
