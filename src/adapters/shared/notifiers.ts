// Notifiers: generic webhook (JSON POST) and Discord (embed). Same classes on both targets (fetch is standard).
// No retries here: the scan job keeps a notification `pending` when any send fails and retries next run.
import type { Notification, Notifier } from '../../ports';

export class WebhookNotifier implements Notifier {
  constructor(
    private readonly url: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}
  async send(n: Notification) {
    try {
      const res = await this.fetchFn(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'cpe-pct' },
        body: JSON.stringify({ source: 'cpe-pct', ...n }),
      });
      return res.ok ? { ok: true } : { ok: false, detail: `webhook ${res.status}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
}

const COLOR = { info: 0x3b82f6, warn: 0xf59e0b, urgent: 0xef4444 } as const;

export class DiscordNotifier implements Notifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}
  async send(n: Notification) {
    try {
      const res = await this.fetchFn(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'CPE PCT',
          embeds: [
            {
              title: n.title.slice(0, 256),
              description: n.body.slice(0, 4096),
              color: COLOR[n.severity],
              footer: { text: `${n.kind} · ${n.key}` },
            },
          ],
        }),
      });
      // Discord returns 204 on success; 429 carries retry_after.
      return res.ok ? { ok: true } : { ok: false, detail: `discord ${res.status}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** Builds the notifier list from settings rows. In-app delivery is the notifications table itself. */
export function notifiersFromSettings(
  settings: Record<string, string>,
  fetchFn: typeof fetch = fetch,
): Notifier[] {
  const out: Notifier[] = [];
  if (settings['notify.webhook_url'])
    out.push(new WebhookNotifier(settings['notify.webhook_url'], fetchFn));
  if (settings['notify.discord_url'])
    out.push(new DiscordNotifier(settings['notify.discord_url'], fetchFn));
  return out;
}
