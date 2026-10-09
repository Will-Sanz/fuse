export const isShowcase = import.meta.env.MODE === 'showcase';

export async function api<T>(path: string, body?: object): Promise<T> {
  if (isShowcase) return (await import('./showcase')).showcaseApi(path, body) as Promise<T>;
  const response = await fetch(`/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.message || result.error || 'Unable to complete the request.');
  return result as T;
}
