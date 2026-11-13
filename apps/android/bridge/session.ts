import type { TokenStore } from '../../../packages/core/src/protocol';
import type { NativeBridge } from '../../../packages/core/src/native';

/** Only the shell sees encrypted storage; the UI never receives the bearer token. */
export class AndroidTokenStore implements TokenStore {
  constructor(private readonly native: NativeBridge) {}
  async read() { await this.native.ready(); return (await this.native.call<{ token: string | null }>('session.read')).token; }
  async write(token: string | null) { await this.native.ready(); await this.native.call('session.write', { token }); }
}
