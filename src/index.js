/*
 * Aji Wira Portfolio — Cloudflare Pages Worker
 *
 * FUNGSI:
 * - Menyimpan API key ElevenLabs di Cloudflare Secret, bukan di browser.
 * - Menjadi proxy /api/tts agar API key tidak pernah terlihat di script.js.
 * - Menggunakan Eleven Flash v2.5 untuk Bahasa Indonesia + latensi rendah.
 * - Mengembalikan stream audio MP3 dari ElevenLabs.
 *
 * WAJIB DI CLOUDFLARE:
 * 1. Workers & Pages -> project -> Settings -> Variables and Secrets.
 * 2. Add -> Secret.
 * 3. Nama secret: ELEVENLABS_API_KEY
 * 4. Isi dengan API key ElevenLabs baru yang valid (biasanya diawali sk_).
 * 5. Save lalu redeploy.
 *
 * Jangan pernah menaruh API key di index.html/script.js/GitHub.
 */

const VOICE_ID = 'cDtCy1lw43ktxm1uFIWJ';
const MODEL_ID = 'eleven_flash_v2_5';
const OUTPUT_FORMAT = 'mp3_22050_32';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/tts') {
      if (request.method !== 'GET') {
        return json({ ok: false, error: 'Method not allowed' }, 405);
      }

      const text = (url.searchParams.get('text') || '').trim();
      if (!text) return json({ ok: false, error: 'Missing text' }, 400);
      if (text.length > 1200) return json({ ok: false, error: 'Text too long' }, 413);

      const apiKey = env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        return json({
          ok: false,
          error: 'ELEVENLABS_API_KEY is not configured in Cloudflare Secrets.'
        }, 503);
      }

      const endpoint = new URL(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`
      );
      endpoint.searchParams.set('output_format', OUTPUT_FORMAT);
      endpoint.searchParams.set('optimize_streaming_latency', '3');

      const upstream = await fetch(endpoint.toString(), {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'content-type': 'application/json',
          'accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
          language_code: 'id',
          voice_settings: {
            stability: 0.38,
            similarity_boost: 0.82,
            style: 0.58,
            use_speaker_boost: true
          }
        })
      });

      if (!upstream.ok) {
        const detail = await upstream.text();
        console.warn('ElevenLabs upstream error:', upstream.status, detail);
        return new Response(detail || JSON.stringify({ ok: false }), {
          status: upstream.status,
          headers: {
            'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          }
        });
      }

      const headers = new Headers();
      headers.set('content-type', upstream.headers.get('content-type') || 'audio/mpeg');
      headers.set('cache-control', 'public, max-age=31536000, immutable');
      headers.set('x-content-type-options', 'nosniff');
      headers.set('access-control-allow-origin', url.origin);

      return new Response(upstream.body, {
        status: 200,
        headers
      });
    }

    return env.ASSETS.fetch(request);
  }
};
