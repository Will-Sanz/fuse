import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { runOpenAiVisual } from '../server/visual-provider.js';

const maxBytes = 512_000;
const input = z.object({ prompt: z.string().min(1).max(384_000) }).strict();
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });

export async function POST(request: Request) {
  const token = process.env.FUSE_SERVICE_TOKEN;
  if (!token) return json({ error: 'The shared AI service is not configured.' }, 503);
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(request.headers.get('authorization') || '');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return json({ error: 'Use your team MCP connection configuration.' }, 401);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return json({ error: 'Expected JSON.' }, 415);
  if (Number(request.headers.get('content-length')) > maxBytes)
    return json({ error: 'Source context is too large.' }, 413);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'Missing source context.' }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return json({ error: 'Source context is too large.' }, 413);
      }
      chunks.push(value);
    }
    const parsed = input.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!parsed.success) return json({ error: 'Invalid visual request.' }, 400);
    if (!process.env.OPENAI_API_KEY) return json({ error: 'AI service unavailable.' }, 503);
    try {
      return json(await runOpenAiVisual(parsed.data.prompt));
    } catch (error) {
      // Provider messages and source context must never enter public responses or logs.
      console.error('Fuse visual generation failed', { type: (error as Error).name });
      return json({ error: 'Visual generation failed. Please retry.' }, 502);
    }
  } catch {
    return json({ error: 'Invalid JSON request.' }, 400);
  } finally {
    reader.releaseLock();
  }
}
