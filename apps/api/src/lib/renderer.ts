/**
 * A client for the dispatcher's render endpoint.
 *
 * The template renderer lives in the dispatcher, in Go, because the
 * dispatcher is what sends the real message. Rendering a preview anywhere
 * else would let the preview and the real send disagree — and a preview
 * that shows a `{{token}}` the real email would not is worse than no
 * preview at all.
 */

import { env } from "@/env";

const BASE = env.DISPATCHER_URL.replace(/\/$/, "");

export interface RenderRequest {
  /** The template text. May be a subject or a body. */
  template: string;
  /** The merge variables, by name. */
  data: Record<string, string>;
  /** Expand spintax. Off by default — a preview that changes every time is not a preview. */
  spintax?: boolean;
}

/**
 * Renders a template against merge variables.
 *
 * A failure returns the template unchanged rather than throwing: a preview
 * that shows the raw template is more useful than an error page, and the
 * caller can see for itself that something is wrong with the variables.
 */
export async function renderTemplate(
  request: RenderRequest,
): Promise<{ rendered: string; ok: boolean }> {
  try {
    const response = await fetch(`${BASE}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { rendered: request.template, ok: false };
    }

    const body = (await response.json()) as { rendered?: string };
    return { rendered: body.rendered ?? request.template, ok: true };
  } catch {
    return { rendered: request.template, ok: false };
  }
}
