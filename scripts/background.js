/**
 * LTenOd - Background Service Worker (v1.4)
 * Multi-Provider LLM Engine.
 * Mendukung: Gemini Native, OpenRouter, DeepSeek, Groq, OpenAI, 9Router / Custom API.
 *
 * Arsitektur v1.4:
 * - Pipeline tunggal: semua tipe soal melewati satu jalur LLM dengan adapter provider,
 *   dan pembacaan respons yang aman (tidak ada lagi response.json() tanpa cek status).
 * - Error terstruktur: setiap kegagalan punya {code, message, advice}.
 * - Auto-retry dengan backoff + fallback berantai ke model/provider cadangan.
 * - Streaming (SSE): progres jawaban dikirim ke content script saat AI sedang menulis.
 * - Riwayat pengerjaan disimpan di storage (ltenod_history) untuk statistik popup.
 * - Tidak ada lagi API key default: konfigurasi wajib diisi pengguna.
 */

'use strict';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const PRESET_PROVIDERS = {
  gemini: { name: 'Google Gemini', type: 'gemini', baseUrl: GEMINI_BASE, defaultModel: 'gemini-2.5-flash-lite' },
  openrouter: { name: 'OpenRouter', type: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'deepseek/deepseek-chat' },
  deepseek: { name: 'DeepSeek', type: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  groq: { name: 'Groq (Ultra Cepat)', type: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
  openai: { name: 'OpenAI (ChatGPT)', type: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  custom: { name: 'Custom / 9Router / Proxy', type: 'openai-compatible', baseUrl: '', defaultModel: '' }
};

const RETRY_DELAYS = [1200, 2600]; // backoff antar percobaan (ms), total 3x per kandidat

/* ------------------------------------------------------------------------- */
/*  Error terstruktur                                                         */
/* ------------------------------------------------------------------------- */

class LTenOdError extends Error {
  constructor(code, message, advice) {
    super(message);
    this.name = 'LTenOdError';
    this.code = code;
    this.advice = advice || '';
  }
}

function mapHttpError(status, bodyText) {
  let apiMsg = '';
  if (bodyText) {
    try { apiMsg = JSON.parse(bodyText).error?.message || ''; } catch { /* abaikan */ }
  }
  const s = `${status}${apiMsg}`.toLowerCase();
  if (status === 429 || s.includes('rate limit') || s.includes('quota')) {
    return new LTenOdError('RATE_LIMIT', apiMsg || 'Kuota / token provider habis (HTTP 429).',
      'Isi ulang kredit, tunggu reset kuota, atau biarkan model cadangan mengambil alih.');
  }
  if (status === 401 || status === 403) {
    return new LTenOdError('AUTH', apiMsg || 'API Key ditolak (HTTP 401/403).', 'Periksa kembali API Key di popup LTenOd.');
  }
  if (status === 404) {
    return new LTenOdError('MODEL_NOT_FOUND', apiMsg || 'Endpoint atau model tidak ditemukan (HTTP 404).',
      'Klik "Deteksi & Periksa Model" lalu pilih model yang valid.');
  }
  if (status === 408 || status === 504) {
    return new LTenOdError('TIMEOUT', apiMsg || 'Server tidak menjawab tepat waktu (HTTP 408/504).', 'Coba model yang lebih ringan.');
  }
  if (status >= 500) {
    return new LTenOdError('SERVER', apiMsg || `Server provider bermasalah (HTTP ${status}).`, 'Tunggu sesaat; model cadangan akan mencoba otomatis.');
  }
  if (status === 400) {
    return new LTenOdError('BAD_REQUEST', apiMsg || 'Permintaan ditolak (HTTP 400).', 'Periksa Base URL dan nama model di popup.');
  }
  return new LTenOdError('HTTP', apiMsg || `Permintaan gagal (HTTP ${status}).`, 'Periksa konfigurasi provider di popup.');
}

/* ------------------------------------------------------------------------- */
/*  Fetch helpers                                                             */
/* ------------------------------------------------------------------------- */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiFetchRaw(url, options = {}) {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new LTenOdError('TIMEOUT', 'Koneksi ke server AI terputus (timeout).', 'Model cadangan akan mencoba otomatis.');
    }
    throw new LTenOdError('NETWORK', `Koneksi gagal: ${err.message || err}`,
      'Periksa internet, Base URL, dan izin situs (permission) untuk domain provider ini di popup.');
  }
}

/** Fetch non-stream: selalu baca TEKS dulu, baru map error. Aman untuk body HTML/JSON. */
async function apiFetch(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await apiFetchRaw(url, { ...options, signal: controller.signal });
    let text = '';
    try {
      text = await response.text();
    } catch {
      throw new LTenOdError('NETWORK', 'Gagal membaca respons dari server.', 'Coba lagi atau ganti provider.');
    }
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------------- */
/*  Konfigurasi & riwayat                                                     */
/* ------------------------------------------------------------------------- */

async function getConf() {
  const res = await chrome.storage.local.get(['provider', 'apiKey', 'baseUrl', 'activeModel', 'fallbackModels']);
  return {
    provider: res.provider || 'gemini',
    apiKey: (res.apiKey || '').trim(),
    baseUrl: (res.baseUrl || '').trim().replace(/\/+$/, ''),
    activeModel: (res.activeModel || '').trim(),
    fallbackModels: Array.isArray(res.fallbackModels) ? res.fallbackModels.filter(f => f && f.model) : []
  };
}

function providerType(providerId) {
  return (PRESET_PROVIDERS[providerId] || PRESET_PROVIDERS.custom).type;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function pushHistory(entry) {
  try {
    const res = await chrome.storage.local.get('ltenod_history');
    const list = Array.isArray(res.ltenod_history) ? res.ltenod_history : [];
    list.unshift(entry);
    if (list.length > 200) list.length = 200;
    await chrome.storage.local.set({ ltenod_history: list });
  } catch { /* storage penuh / tidak tersedia: jangan blokir alur utama */ }
}

async function setHistoryStatus(id, status) {
  if (!id) return;
  try {
    const res = await chrome.storage.local.get('ltenod_history');
    const list = Array.isArray(res.ltenod_history) ? res.ltenod_history : [];
    const item = list.find(x => x.id === id);
    if (item) {
      item.status = status;
      await chrome.storage.local.set({ ltenod_history: list });
    }
  } catch { /* abaikan */ }
}

/* ------------------------------------------------------------------------- */
/*  Payload builder per provider                                              */
/* ------------------------------------------------------------------------- */

function geminiImageParts(images) {
  const parts = [];
  for (const img of images || []) {
    if (img && img.data && img.mimeType) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
  }
  return parts;
}

function openAIImageParts(images) {
  const parts = [];
  for (const img of images || []) {
    if (img && img.data && img.mimeType) {
      parts.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
    }
  }
  return parts;
}

function buildGeminiPayload(spec) {
  const text = spec.systemPrompt ? `${spec.systemPrompt}\n\n${spec.userText}` : spec.userText;
  return {
    contents: [{ role: 'user', parts: [{ text }, ...geminiImageParts(spec.images)] }],
    generationConfig: {
      temperature: spec.temperature,
      maxOutputTokens: spec.maxTokens,
      responseMimeType: 'application/json'
    }
  };
}

function buildOpenAIPayload(spec, model) {
  const textParts = [{ type: 'text', text: spec.userText }];
  const imageParts = openAIImageParts(spec.images);
  const userContent = imageParts.length > 0 ? [...textParts, ...imageParts] : spec.userText;
  return {
    model,
    messages: [
      { role: 'system', content: spec.systemPrompt },
      { role: 'user', content: userContent }
    ],
    temperature: spec.temperature,
    max_tokens: spec.maxTokens,
    stream: true
  };
}

/** Ambil teks jawaban dari respons JSON utuh (provider tanpa streaming). */
function extractProviderText(bodyText, isGemini) {
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new LTenOdError('BAD_RESPONSE', 'Respons provider bukan JSON valid.', 'Coba model lain atau periksa Base URL.');
  }
  if (isGemini) {
    const parts = json.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || '').join('');
    if (!text) throw new LTenOdError('BAD_RESPONSE', 'Tidak ada teks pada respons Gemini.', 'Coba model lain.');
    return text;
  }
  const text = json.choices?.[0]?.message?.content || '';
  if (!text) throw new LTenOdError('BAD_RESPONSE', 'Tidak ada teks pada respons provider.', 'Coba model lain.');
  return text;
}

/* ------------------------------------------------------------------------- */
/*  Streaming (SSE) dengan idle-timeout + hard-cap                            */
/* ------------------------------------------------------------------------- */

async function streamCall(candidate, spec, onProgress) {
  const isGemini = candidate.type === 'gemini';
  let url;
  let init;
  if (isGemini) {
    url = `${GEMINI_BASE}/models/${encodeURIComponent(candidate.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(candidate.apiKey)}`;
    init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildGeminiPayload(spec)) };
  } else {
    if (!candidate.baseUrl) {
      throw new LTenOdError('NO_BASE_URL', 'Base URL belum diisi untuk provider ini.', 'Isi Base URL di popup atau pilih provider preset.');
    }
    url = `${candidate.baseUrl}/chat/completions`;
    init = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${candidate.apiKey}`,
        'HTTP-Referer': 'https://github.com/fidhera/LTenOd',
        'X-Title': 'LTenOd'
      },
      body: JSON.stringify(buildOpenAIPayload(spec, candidate.model))
    };
  }

  const controller = new AbortController();
  const hardCap = setTimeout(() => controller.abort(), spec.hardTimeoutMs || 90000);
  let idleTimer = null;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), spec.idleTimeoutMs || 25000);
  };
  resetIdle();

  try {
    const response = await apiFetchRaw(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw mapHttpError(response.status, bodyText);
    }

    const ctype = (response.headers.get('content-type') || '').toLowerCase();
    if (!response.body || (!ctype.includes('event-stream') && !ctype.includes('stream'))) {
      // Provider tidak mengirim stream: respons JSON utuh
      const bodyText = await response.text();
      return extractProviderText(bodyText, isGemini);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let lastSent = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        resetIdle();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (!dataStr || dataStr === '[DONE]') continue;
          try {
            const json = JSON.parse(dataStr);
            const delta = isGemini
              ? (json.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '')
              : (json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || '');
            if (delta) full += delta;
          } catch { // baris SSE belum lengkap/buggy: lewati
          }
        }
        const now = Date.now();
        if (onProgress && full && now - lastSent > 600) {
          lastSent = now;
          onProgress(full);
        }
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        if (full.trim()) return full; // cukup data meski koneksi diputus idle-guard
        throw new LTenOdError('TIMEOUT', 'Stream AI terhenti (tidak ada data bertahap).', 'Model cadangan akan mencoba otomatis.');
      }
      throw err;
    }

    if (!full.trim()) {
      throw new LTenOdError('BAD_RESPONSE', 'Model tidak mengirim teks apa pun.', 'Coba model lain di popup.');
    }
    return full;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(hardCap);
  }
}

/* ------------------------------------------------------------------------- */
/*  Orkestrasi: retry backoff + fallback berantai                             */
/* ------------------------------------------------------------------------- */

function sendProgress(tabId, text, model, isFallback) {
  if (!tabId) return;
  try {
    chrome.tabs.sendMessage(tabId, {
      action: 'llmProgress',
      chars: text.length,
      tail: text.slice(-70),
      model,
      isFallback
    }).catch(() => {});
  } catch { /* tab sudah ditutup */ }
}

function sendStatus(tabId, message) {
  if (!tabId) return;
  try {
    chrome.tabs.sendMessage(tabId, { action: 'llmStatus', message }).catch(() => {});
  } catch { /* tab sudah ditutup */ }
}

async function runLLM(spec, tabId) {
  const conf = await getConf();
  if (!conf.apiKey) {
    throw new LTenOdError('NO_KEY', 'API Key belum diisi.', 'Buka popup LTenOd dan masukkan API Key provider Anda.');
  }

  const chain = [{
    provider: conf.provider,
    type: providerType(conf.provider),
    model: conf.activeModel,
    baseUrl: conf.baseUrl,
    apiKey: conf.apiKey
  }];
  for (const fb of conf.fallbackModels) {
    chain.push({
      provider: fb.provider,
      type: providerType(fb.provider),
      model: fb.model,
      baseUrl: (fb.baseUrl || '').trim().replace(/\/+$/, ''),
      apiKey: (fb.apiKey || conf.apiKey).trim()
    });
  }

  let lastErr = null;
  for (let ci = 0; ci < chain.length; ci++) {
    const cand = chain[ci];
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const t0 = Date.now();
        const raw = await streamCall(cand, spec, (text) => sendProgress(tabId, text, cand.model, ci > 0));
        const parsed = spec.parse(raw, cand.model);
        parsed.modelUsed = cand.model;
        parsed.meta = {
          latencyMs: Date.now() - t0,
          attempts: attempt + 1,
          fallbackUsed: ci > 0,
          chainSize: chain.length
        };
        return parsed;
      } catch (err) {
        lastErr = err;
        const retryable = err instanceof LTenOdError && ['TIMEOUT', 'SERVER', 'NETWORK', 'RATE_LIMIT'].includes(err.code);
        if (retryable && attempt < RETRY_DELAYS.length) {
          sendStatus(tabId, `Gangguan (${err.code}), mencoba ulang ${attempt + 2}/${RETRY_DELAYS.length + 1}...`);
          await sleep(RETRY_DELAYS[attempt] + Math.floor(Math.random() * 400));
          continue;
        }
        break; // lanjut ke kandidat fallback berikutnya
      }
    }
  }
  throw lastErr || new LTenOdError('HTTP', 'Permintaan gagal tanpa keterangan.', 'Periksa konfigurasi provider.');
}

/* ------------------------------------------------------------------------- */
/*  Parsing respons                                                           */
/* ------------------------------------------------------------------------- */

function parseJsonResponse(rawText, modelUsed) {
  let cleaned = String(rawText || '').trim();
  cleaned = cleaned.replace(/^```json/im, '').replace(/^```/im, '').replace(/```$/im, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) cleaned = match[0];
  try {
    const parsed = JSON.parse(cleaned);
    parsed.modelUsed = modelUsed;
    return parsed;
  } catch {
    throw new LTenOdError('BAD_RESPONSE', `Format jawaban AI tidak valid: ${cleaned.slice(0, 80)}`, 'Coba model lain yang lebih stabil untuk JSON.');
  }
}

function parseCodeRunnerResponse(rawText, modelUsed, isFix = false) {
  let cleaned = String(rawText || '').trim();
  let code = '';
  let explanation = '';

  try {
    const jsonCandidate = cleaned.replace(/^```json/im, '').replace(/^```/im, '').replace(/```$/im, '').trim();
    const match = jsonCandidate.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.code) {
        code = parsed.code;
        explanation = parsed.explanation || '';
      }
    }
  } catch { // coba jalur berikutnya
  }

  if (!code) {
    const blockMatch = cleaned.match(/```(?:python3|python|py|c|cpp|java|javascript|js)?\s*([\s\S]*?)```/i);
    if (blockMatch && blockMatch[1].trim()) {
      code = blockMatch[1].trim();
      explanation = 'Kode program diekstrak dari respon model.';
    }
  }

  if (!code) {
    code = cleaned;
    explanation = isFix ? 'Kode perbaikan dari AI.' : 'Solusi koding dari AI.';
  }

  return {
    type: 'coderunner',
    code,
    explanation,
    isFix,
    confidence: isFix ? 'Refined' : 'Tinggi'
  };
}

function parseMatchingResponse(rawText, modelUsed) {
  let cleaned = String(rawText || '').trim();
  cleaned = cleaned.replace(/^```json/im, '').replace(/^```/im, '').replace(/```$/im, '').trim();
  let matches = [];
  try {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) matches = parsed;
      else if (parsed.matches && Array.isArray(parsed.matches)) matches = parsed.matches;
    }
  } catch {
    throw new LTenOdError('BAD_RESPONSE', 'Format jawaban matching AI tidak valid.', 'Coba model lain yang lebih stabil untuk JSON.');
  }
  return { type: 'matching', matches, confidence: 'Tinggi' };
}

/* ------------------------------------------------------------------------- */
/*  Solver: builder prompt per tipe soal                                      */
/* ------------------------------------------------------------------------- */

const SOLVERS = {
  multichoice: {
    build(data) {
      const optionsFormatted = (data.options || []).map(opt => `${opt.letter}. ${opt.text}`).join('\n');
      let eliminated = '';
      if (Array.isArray(data.eliminatedOptions) && data.eliminatedOptions.length > 0) {
        eliminated = '\nPERHATIAN - OPSI BERIKUT SUDAH DICOBA DAN SALAH (ELIMINASI):\n' +
          data.eliminatedOptions.map(o => `- ${o}`).join('\n') +
          '\nDILARANG MEMILIH OPSI DI ATAS! Pilihlah dari opsi lain yang tersisa!\n';
      }
      const userText = `Soal kuis pilihan ganda:
SOAL:
${data.questionText}

PILIHAN:
${optionsFormatted}
${eliminated}
Kembalikan HANYA JSON:
{
  "index_jawaban": 0,
  "huruf_jawaban": "A",
  "teks_jawaban": "isi",
  "alasan": "penjelasan singkat 1 kalimat",
  "confidence": "tinggi"
}
Catatan: "index_jawaban" integer 0-based (A=0, B=1, C=2, D=3). "confidence": "tinggi" | "sedang" | "rendah".`;
      return {
        systemPrompt: 'Anda adalah asisten pemecah soal pilihan ganda akademik yang akurat. Jawaban Anda HARUS HANYA berupa JSON valid tanpa tanda pembungkus markdown apa pun.',
        userText,
        images: data.images || [],
        temperature: 0,
        maxTokens: 300,
        timeoutMs: 20000,
        hardTimeoutMs: 35000,
        idleTimeoutMs: 20000,
        parse: parseJsonResponse
      };
    }
  },

  coderunner: {
    build(data) {
      const lang = data.lang || 'Python';
      let userText = '';
      const isFix = Array.isArray(data.failedTests) && data.failedTests.length > 0;

      if (isFix) {
        let failureDetails = '';
        data.failedTests.forEach((ft, i) => {
          failureDetails += `--- TEST CASE ${ft.testIndex || (i + 1)} GAGAL ---\n` +
            `[INPUT]:\n${ft.input || '(tanpa argumen/stdin)'}\n\n` +
            `[EXPECTED OUTPUT (WAJIB PERSIS SAMA)]:\n${ft.expected}\n\n` +
            `[GOT OUTPUT (OUTPUT SALAH DARI KODE ANDA)]:\n${ft.got}\n` +
            `-----------------------------------------\n\n`;
        });
        userText = `Anda adalah programmer expert untuk praktikum pemrograman (${lang}).
KODE SEBELUMNYA TELAH DIUJI DENGAN TEST CASE CODERUNNER, NAMUN ${data.failedTests.length} TEST CASE MENGALAMI KEGAGALAN!

RINCIAN PERBANDINGAN EXPECTED OUTPUT VS GOT OUTPUT:
${failureDetails}
KODE PROGRAM SEBELUMNYA YANG SEDANG DIUJI (PERBAIKI INI):
\`\`\`${lang}
${data.currentCode || data.starterCode}
\`\`\`

INSTRUKSI & ATURAN SOAL:
${data.questionText}

TUGAS ANDA:
1. Analisis mendalam perbedaan antara "Got Output" dan "Expected Output".
2. Temukan penyebab perbedaan tersebut (keyword/token yang kurang, kesalahan logika parsing, karakter pemisah, perulangan, atau formatting newline).
3. Perbaiki seluruh kode program sehingga menghasilkan output yang PERSIS sesuai "Expected Output" pada semua test case.
4. Tetap patuhi batasan soal (misal dilarang pakai re/eval, pertahankan struktur nama class/method).
5. Kembalikan HANYA JSON valid:
{
  "code": "seluruh kode program lengkap yang sudah diperbaiki dari baris pertama sampai terakhir",
  "explanation": "penjelasan singkat akar masalah yang diperbaiki"
}`;
      } else {
        userText = `Anda adalah programmer expert untuk praktikum pemrograman (${lang}).
Berikut instruksi soal praktikum dan starter code yang harus diselesaikan:

INSTRUKSI & CONTOH TEST CASE:
${data.questionText}

KODE TEMPLATE / STARTER CODE:
\`\`\`${lang}
${data.starterCode}
\`\`\`

TUGAS ANDA:
1. Pahami aturan dan batasan soal dengan teliti (misal: dilarang import modul tertentu / regular expression, dilarang hardcode).
2. Lengkapi SEMUA TODO yang ada di dalam kode starter sehingga lolos semua test case.
3. Pertahankan nama fungsi, nama kelas, signature method, dan struktur yang sudah ada.
4. Kembalikan HANYA JSON valid:
{
  "code": "seluruh isi kode program lengkap dari baris pertama sampai terakhir yang sudah siap pakai",
  "explanation": "ringkasan singkat apa saja TODO yang telah diselesaikan"
}`;
      }

      return {
        systemPrompt: 'Anda adalah programmer expert yang menyelesaikan soal praktikum koding. Output Anda HARUS berupa JSON valid tanpa teks lain.',
        userText,
        images: data.images || [],
        temperature: 0.1,
        maxTokens: 6000,
        timeoutMs: 40000,
        hardTimeoutMs: 90000,
        idleTimeoutMs: 30000,
        parse: (raw, model) => parseCodeRunnerResponse(raw, model, isFix)
      };
    }
  },

  matching: {
    build(data) {
      const itemsText = (data.items || []).map(it => `Item ${it.index}: "${it.itemText}"`).join('\n');
      let optionsText = '';
      if (data.items && data.items.length > 0 && data.items[0].options) {
        optionsText = data.items[0].options.map(opt => `- Value: "${opt.value}" | Teks: "${opt.text}"`).join('\n');
      }
      const userText = `Anda adalah asisten cerdas untuk menyelesaikan soal mencocokkan pasangan kata/makna/konsep (Matching Question).
SOAL:
${data.questionText}

DAFTAR KATA / PERTANYAAN:
${itemsText}

PILIHAN JAWABAN PADA DROPDOWN (Setiap item memilih satu yang paling tepat):
${optionsText}

TUGAS:
Cocokkan SETIAP kata/pertanyaan di atas dengan pilihan jawaban yang paling tepat.
PENTING:
- "index": integer 0-based sesuai nomor Item di atas (0 untuk item pertama, 1 untuk item kedua, dst).
- "itemText": teks kata yang dicocokkan persis sesuai daftar.
- "chosenValue": nilai atribut value dari opsi yang dipilih pada elemen select.
- "chosenText": teks lengkap opsi yang dipilih.

Kembalikan HANYA format JSON valid tanpa teks atau markdown pembungkus:
{
  "matches": [
    { "index": 0, "itemText": "kata yang dicocokkan", "chosenValue": "nilai value dari opsi", "chosenText": "teks lengkap opsi yang dipilih" }
  ]
}`;
      return {
        systemPrompt: 'Anda asisten penyelesaian soal matching. Output HARUS JSON valid tanpa teks lain.',
        userText,
        images: data.images || [],
        temperature: 0,
        maxTokens: 2048,
        timeoutMs: 25000,
        hardTimeoutMs: 60000,
        idleTimeoutMs: 25000,
        parse: parseMatchingResponse
      };
    }
  }
};

/* ------------------------------------------------------------------------- */
/*  Handler utama                                                             */
/* ------------------------------------------------------------------------- */

function answerLabel(result) {
  if (result.type === 'coderunner') return '(kode)';
  if (result.type === 'matching') return `${(result.matches || []).length} pasangan`;
  return `${result.huruf_jawaban || '?'} ${String(result.teks_jawaban || '').slice(0, 40)}`.trim();
}

async function handleSolveQuestion(data, tabId) {
  const solver = SOLVERS[data.type] || SOLVERS.multichoice;
  const spec = solver.build(data);

  let result;
  try {
    result = await runLLM(spec, tabId);
  } catch (err) {
    await pushHistory({
      id: uid(),
      ts: Date.now(),
      type: data.type,
      model: '',
      question: String(data.questionText || '').slice(0, 90),
      answer: '',
      status: 'error',
      error: err.code || 'ERROR'
    });
    throw err;
  }

  const entry = {
    id: uid(),
    ts: Date.now(),
    type: data.type,
    model: result.modelUsed,
    question: String(data.questionText || '').slice(0, 90),
    answer: answerLabel(result),
    status: 'pending',
    latencyMs: result.meta.latencyMs,
    fallbackUsed: result.meta.fallbackUsed
  };
  await pushHistory(entry);
  result.historyId = entry.id;
  return result;
}

async function handleDetectModels({ provider, apiKey, baseUrl }) {
  const start = Date.now();
  const cleanKey = (apiKey || '').trim();
  const cleanBase = (baseUrl || '').trim().replace(/\/+$/, '');

  if (!cleanKey) throw new LTenOdError('NO_KEY', 'API Key belum diisi.', 'Masukkan API Key terlebih dahulu.');

  if (provider === 'gemini') {
    const { response, text } = await apiFetch(`${GEMINI_BASE}/models?key=${encodeURIComponent(cleanKey)}`, { method: 'GET' }, 8000);
    if (!response.ok) throw mapHttpError(response.status, text);
    let data;
    try { data = JSON.parse(text); } catch { throw new LTenOdError('BAD_RESPONSE', 'Respons daftar model Gemini tidak valid.', 'Coba lagi.'); }
    const modelList = (data.models || [])
      .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
      .map(m => m.name.replace('models/', ''));
    const preferred = modelList.find(m => m === 'gemini-2.5-flash-lite')
      || modelList.find(m => m === 'gemini-2.5-flash')
      || modelList.find(m => m.includes('flash-lite'))
      || modelList.find(m => m.includes('flash'))
      || modelList[0]
      || 'gemini-2.5-flash-lite';
    return { models: modelList, activeModel: preferred, latency: Date.now() - start };
  }

  if (!cleanBase) throw new LTenOdError('NO_BASE_URL', 'Base URL wajib diisi untuk provider custom / router.', 'Isi Base URL, contoh: https://api.9router.com/v1');

  const endpoint = `${cleanBase}/models`;
  const { response, text } = await apiFetch(endpoint, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${cleanKey}`,
      'HTTP-Referer': 'https://github.com/fidhera/LTenOd',
      'X-Title': 'LTenOd'
    }
  }, 10000);
  if (!response.ok) throw mapHttpError(response.status, text);

  let data;
  try { data = JSON.parse(text); } catch { throw new LTenOdError('BAD_RESPONSE', 'Respons daftar model tidak valid (bukan JSON).', 'Periksa Base URL; pastikan mengarah ke endpoint API yang benar.'); }

  let modelList = [];
  if (Array.isArray(data.data)) modelList = data.data.map(m => m.id);
  else if (Array.isArray(data.models)) modelList = data.models.map(m => m.id || m.name || m);
  else if (Array.isArray(data)) modelList = data.map(m => m.id || m);

  if (modelList.length === 0) {
    throw new LTenOdError('EMPTY_MODELS', 'Koneksi berhasil tetapi tidak ada model aktif di akun/router ini.', 'Periksa akun router Anda atau gunakan provider lain.');
  }

  const filtered = modelList.filter(id => {
    const s = String(id).toLowerCase();
    return !s.includes('embed') && !s.includes('whisper') && !s.includes('tts') && !s.includes('dall-e');
  });
  const finalModels = filtered.length > 0 ? filtered : modelList;
  return { models: finalModels, activeModel: finalModels[0], latency: Date.now() - start };
}

/* ------------------------------------------------------------------------- */
/*  Router pesan                                                              */
/* ------------------------------------------------------------------------- */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) return false;

  if (request.action === 'solveQuestion') {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    handleSolveQuestion(request.data, tabId)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({
        success: false,
        error: err.message || 'Kesalahan tidak diketahui.',
        errorCode: err.code || 'ERROR',
        errorAdvice: err.advice || ''
      }));
    return true;
  }

  if (request.action === 'testAndDetectModels') {
    handleDetectModels(request.config || {})
      .then(res => sendResponse({ success: true, ...res }))
      .catch(err => sendResponse({ success: false, error: err.message || 'Gagal.', errorCode: err.code || 'ERROR', errorAdvice: err.advice || '' }));
    return true;
  }

  if (request.action === 'fetchImage') {
    (async () => {
      try {
        const res = await fetch(request.url, { credentials: 'omit' });
        if (!res.ok) return sendResponse({ success: false });
        const blob = await res.blob();
        const buf = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        const CHUNK = 8192;
        for (let i = 0; i < buf.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
        }
        sendResponse({ success: true, mimeType: blob.type || 'image/png', data: btoa(binary) });
      } catch {
        sendResponse({ success: false });
      }
    })();
    return true;
  }

  if (request.action === 'reportOutcome') {
    setHistoryStatus(request.id, request.status)
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['provider', 'baseUrl', 'activeModel', 'solveMode', 'minDelay', 'maxDelay', 'audioAlert', 'fallbackModels'], (res) => {
    const patch = {};
    if (!res.provider) patch.provider = 'gemini';
    if (!res.baseUrl) patch.baseUrl = PRESET_PROVIDERS.gemini.baseUrl;
    if (!res.activeModel) patch.activeModel = PRESET_PROVIDERS.gemini.defaultModel;
    if (!res.solveMode) patch.solveMode = 'auto';
    if (res.minDelay === undefined) patch.minDelay = 1;
    if (res.maxDelay === undefined) patch.maxDelay = 3;
    if (res.audioAlert === undefined) patch.audioAlert = true;
    if (!Array.isArray(res.fallbackModels)) patch.fallbackModels = [];
    if (Object.keys(patch).length) chrome.storage.local.set(patch);
  });
});
