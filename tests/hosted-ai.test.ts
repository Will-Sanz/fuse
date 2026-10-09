import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../api/visual';
import { runVisualModel } from '../server/visual-provider';
import { checkoutVisual } from '../shared/demo-visuals';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const request = (body: unknown, token = 'team-token') =>
  new Request('https://fuse.example/api/visual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
const providerResult = {
  id: 'resp-real',
  model: 'gpt-6-luna',
  status: 'completed',
  output: [
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(checkoutVisual) }] },
  ],
};
describe('shared hosted AI', () => {
  it('fails closed and rejects credentials, extra fields, and oversized inputs before billing', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubEnv('FUSE_SERVICE_TOKEN', '');
    expect((await POST(request({ prompt: 'code' }))).status).toBe(503);
    vi.stubEnv('FUSE_SERVICE_TOKEN', 'team-token');
    expect((await POST(request({ prompt: 'code' }, 'wrong-token'))).status).toBe(401);
    expect((await POST(request({ prompt: 'code', model: 'expensive' }))).status).toBe(400);
    expect((await POST(request({ prompt: 'x'.repeat(512_001) }))).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses only the server key and fixed model contract, with no stored response or raw error leak', async () => {
    vi.stubEnv('FUSE_SERVICE_TOKEN', 'team-token');
    vi.stubEnv('OPENAI_API_KEY', 'server-only-key');
    vi.stubEnv('FUSE_AI_MODEL', 'gpt-6-luna');
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(providerResult)));
    vi.stubGlobal('fetch', fetch);
    const response = await POST(request({ prompt: 'code' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      spec: checkoutVisual,
      responseId: 'resp-real',
      model: 'gpt-6-luna',
    });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options.headers.Authorization).toBe('Bearer server-only-key');
    expect(JSON.parse(options.body)).toMatchObject({
      model: 'gpt-6-luna',
      store: false,
      max_output_tokens: 12000,
    });
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'sensitive provider error' } }), {
        status: 401,
      }),
    );
    const failed = await POST(request({ prompt: 'code' }));
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain('sensitive');
  });
  it('generates on a teammate machine without an OpenAI key and never forwards an owner key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('FUSE_SERVICE_TOKEN', 'team-token');
    vi.stubEnv('FUSE_AI_URL', 'https://fuse.example/api/visual');
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ spec: checkoutVisual, model: 'gpt-6-luna', responseId: 'resp-real' }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    expect((await runVisualModel('code')).spec).toEqual(checkoutVisual);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer team-token');
    expect(fetch.mock.calls[0][1].redirect).toBe('error');
    vi.stubEnv('OPENAI_API_KEY', 'owner-key-must-stay-local');
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ spec: checkoutVisual, model: 'gpt-6-luna', responseId: 'resp-next' }),
      ),
    );
    await runVisualModel('code');
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('owner-key');
    vi.stubEnv('FUSE_AI_URL', 'http://untrusted.example');
    await expect(runVisualModel('code')).rejects.toThrow('HTTPS');
    vi.stubEnv('FUSE_AI_URL', 'https://fuse.example/api/visual');
    fetch.mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(runVisualModel('code')).rejects.toThrow('team MCP configuration');
  });
});
