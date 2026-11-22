import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface EmailAttachment {
  filename: string;
  /** Plain text or bytes. Sent base64 encoded. */
  content: string | Buffer;
  contentType?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
  /** Same key sent twice = delivered once by the provider. */
  idempotencyKey?: string;
}

export interface EmailTransport {
  send(m: EmailMessage): Promise<{ id: string }>;
}

/** Resend over HTTPS. No SDK needed. Free plan: 100 emails a day, 3,000 a month. */
export class ResendTransport implements EmailTransport {
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(m: EmailMessage): Promise<{ id: string }> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(m.idempotencyKey ? { "Idempotency-Key": m.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: this.from, to: [m.to], subject: m.subject, html: m.html, text: m.text,
        ...(m.replyTo ? { reply_to: m.replyTo } : {}),
        ...(m.attachments?.length
          ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") })) }
          : {}),
      }),
    });
    // Never include the response body or the message in errors: they can contain the patient's address and name.
    if (!res.ok) throw new Error(`Email provider rejected the message (HTTP ${res.status})`);
    const data = (await res.json()) as { id?: string };
    return { id: data.id ?? "unknown" };
  }
}

/**
 * Development only (EMAIL_TRANSPORT=console). Prints a one-line summary and saves each email as an HTML file in
 * `.devmail/` so it can be opened in a browser. Refused in production.
 */
export class ConsoleTransport implements EmailTransport {
  private n = 0;
  constructor(private readonly dir = join(process.cwd(), ".devmail")) {}

  async send(m: EmailMessage): Promise<{ id: string }> {
    mkdirSync(this.dir, { recursive: true });
    const id = `dev-${Date.now()}-${++this.n}`;
    const file = join(this.dir, `${id}.html`);
    const attach = m.attachments?.map((a) => a.filename).join(", ");
    writeFileSync(file, `<!-- To: ${m.to} | Subject: ${m.subject}${attach ? ` | Attachments: ${attach}` : ""} -->\n${m.html}`);
    console.log(`[email:console] to=${m.to} subject="${m.subject}" file=${file}`);
    return { id };
  }
}

/** Tests: keeps every message in memory. */
export class MemoryTransport implements EmailTransport {
  sent: EmailMessage[] = [];
  failNext = 0;
  async send(m: EmailMessage): Promise<{ id: string }> {
    if (this.failNext > 0) { this.failNext--; throw new Error("provider down"); }
    this.sent.push(m);
    return { id: `mem-${this.sent.length}` };
  }
}

/** Fails clearly when keys are missing. There is no silent fallback in production (CLAUDE.md section 4). */
export function createTransportFromEnv(env: Record<string, string | undefined> = process.env): EmailTransport {
  const mode = env.EMAIL_TRANSPORT ?? "resend";
  if (mode === "console") {
    if (env.NODE_ENV === "production") throw new Error("EMAIL_TRANSPORT=console is for development only");
    return new ConsoleTransport();
  }
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  if (!env.EMAIL_FROM) throw new Error("EMAIL_FROM is not set");
  return new ResendTransport(env.RESEND_API_KEY, env.EMAIL_FROM);
}
