import { NextResponse } from 'next/server';

const cache = new Map<string, { at: number; data: any }>();
const TTL = 5 * 60 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  if (!q || q.length < 2) {
    return NextResponse.json(
      { error: 'query minimal 2 karakter' },
      { status: 400, headers: CORS }
    );
  }

  const cached = cache.get(q);
  if (cached && Date.now() - cached.at < TTL) {
    return NextResponse.json({ ...cached.data, cached: true }, { headers: CORS });
  }

  try {
    const upstream = await fetch(
      `https://amfinder.web.id/api/search?mode=pick&q=${encodeURIComponent(q)}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/event-stream' },
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'upstream error', status: upstream.status },
        { status: 502, headers: CORS }
      );
    }

    const raw = await upstream.text();
    const items = parseSSE(raw);
    const payload = { query: q, count: items.length, items };
    cache.set(q, { at: Date.now(), data: payload });

    return NextResponse.json(payload, { headers: CORS });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'fetch failed', message: e.message },
      { status: 500, headers: CORS }
    );
  }
}

function parseSSE(text: string) {
  const items: any[] = [];
  for (const block of text.split('\n\n')) {
    if (!block.includes('event: candidates')) continue;
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    try {
      const parsed = JSON.parse(data);
      for (const it of parsed.items || []) {
        items.push({
          url: it.url,
          handle: it.handle,
          kind: it.kind,
          snippet: (it.snippet || '').slice(0, 300),
          thumb: it.thumb,
        });
      }
    } catch {}
  }
  return items;
}
