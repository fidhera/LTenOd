/**
 * LTenOd - Background Service Worker
 * Universal Multi-Provider Engine:
 * Mendukung Gemini Native, OpenRouter, DeepSeek, Groq, OpenAI, dan 9Router / Custom API.
 * Fitur:
 * - Soal Pilihan Ganda (Multichoice)
 * - Soal Praktikum Koding (CodeRunner / Ace Editor)
 */

const DEFAULT_GEMINI_KEY = 'AIzaSyDc5Rc25k1StZPVwBZfVZy_LsbAv-Z5A28';

const PRESET_PROVIDERS = {
  gemini: {
    name: 'Google Gemini',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.5-flash-lite'
  },
  openrouter: {
    name: 'OpenRouter',
    type: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-chat'
  },
  deepseek: {
    name: 'DeepSeek',
    type: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat'
  },
  groq: {
    name: 'Groq (Ultra Cepat)',
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile'
  },
  openai: {
    name: 'OpenAI (ChatGPT)',
    type: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini'
  },
  custom: {
    name: 'Custom / 9Router / Proxy',
    type: 'openai-compatible',
    baseUrl: '',
    defaultModel: ''
  }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['provider', 'apiKey', 'baseUrl', 'activeModel', 'solveMode', 'minDelay', 'maxDelay'], (res) => {
    chrome.storage.local.set({
      provider: res.provider || 'gemini',
      apiKey: res.apiKey || DEFAULT_GEMINI_KEY,
      baseUrl: res.baseUrl || PRESET_PROVIDERS.gemini.baseUrl,
      activeModel: res.activeModel || PRESET_PROVIDERS.gemini.defaultModel,
      solveMode: res.solveMode || 'auto',
      minDelay: res.minDelay || 1,
      maxDelay: res.maxDelay || 3,
      audioAlert: res.audioAlert ?? true
    });
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'solveQuestion') {
    handleSolveQuestion(request.data)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'testAndDetectModels') {
    handleDetectModels(request.config)
      .then(res => sendResponse({ success: true, ...res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function fetchWithTimeout(url, options, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Koneksi timeout (>${Math.round(timeoutMs / 1000)} detik). Server AI atau sinyal internet lambat.`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Panggil API (Gemini Native atau OpenAI-Compatible / 9Router)
 */
async function handleSolveQuestion(data) {
  const conf = await chrome.storage.local.get(['provider', 'apiKey', 'baseUrl', 'activeModel']);
  const provider = conf.provider || 'gemini';
  const apiKey = (conf.apiKey || '').trim();
  const model = (conf.activeModel || '').trim();
  const baseUrl = (conf.baseUrl || '').trim().replace(/\/+$/, '');

  if (!apiKey) {
    throw new Error('API Key belum diisi. Buka popup untuk memasukkan API Key.');
  }

  // Tipe 1: Soal Praktikum Koding (CodeRunner)
  if (data.type === 'coderunner') {
    if (provider === 'gemini') {
      return await solveCodeRunnerWithGemini({ apiKey, model, ...data });
    } else {
      return await solveCodeRunnerWithOpenAICompatible({ baseUrl, apiKey, model, ...data });
    }
  }

  // Tipe 2: Soal Pilihan Ganda (Multichoice)
  const { questionText, options, images } = data;
  const optionsFormatted = (options || []).map((opt) => `${opt.letter}. ${opt.text}`).join('\n');

  if (provider === 'gemini') {
    return await solveWithGeminiNative({ apiKey, model, questionText, optionsFormatted, images });
  }

  return await solveWithOpenAICompatible({ baseUrl, apiKey, model, questionText, optionsFormatted, images });
}

/**
 * Pemecah soal pilihan ganda via Gemini Native
 */
async function solveWithGeminiNative({ apiKey, model, questionText, optionsFormatted, images }) {
  const userPrompt = `Soal kuis pilihan ganda:
SOAL:
${questionText}

PILIHAN:
${optionsFormatted}

Kembalikan HANYA JSON:
{
  "index_jawaban": 0,
  "huruf_jawaban": "A",
  "teks_jawaban": "isi",
  "alasan": "penjelasan singkat 1 kalimat",
  "confidence": "tinggi"
}
Catatan: "index_jawaban" integer 0-based (A=0, B=1, C=2, D=3). "confidence": "tinggi" | "sedang" | "rendah".`;

  const parts = [{ text: userPrompt }];

  if (images && images.length > 0) {
    for (const img of images) {
      if (img.data && img.mimeType) {
        parts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.data
          }
        });
      }
    }
  }

  const payload = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 250,
      responseMimeType: 'application/json'
    }
  };

  const targetModel = model || 'gemini-3.5-flash-lite';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }, 20000);

  const resJson = await response.json();
  if (!response.ok) {
    throw new Error(resJson.error?.message || `HTTP ${response.status}`);
  }

  const rawText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Tidak ada respon teks dari model.');

  return parseJsonResponse(rawText, targetModel);
}

/**
 * Pemecah soal koding (CodeRunner) via Google Gemini Native
 */
async function solveCodeRunnerWithGemini({ apiKey, model, questionText, starterCode, lang, images }) {
  const userPrompt = `Anda adalah programmer expert untuk praktikum pemrograman (${lang || 'Python'}).
Berikut instruksi soal praktikum dan starter code yang harus diselesaikan:

INSTRUKSI & CONTOH TEST CASE:
${questionText}

KODE TEMPLATE / STARTER CODE:
\`\`\`${lang || 'python'}
${starterCode}
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

  const parts = [{ text: userPrompt }];

  if (images && images.length > 0) {
    for (const img of images) {
      if (img.data && img.mimeType) {
        parts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.data
          }
        });
      }
    }
  }

  const payload = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json'
    }
  };

  const targetModel = model || 'gemini-3.5-flash-lite';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }, 35000);

  const resJson = await response.json();
  if (!response.ok) {
    throw new Error(resJson.error?.message || `HTTP ${response.status}`);
  }

  const rawText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Tidak ada respon teks dari model.');

  return parseCodeRunnerResponse(rawText, targetModel);
}

/**
 * Pemecah soal pilihan ganda via OpenAI-Compatible / 9Router
 */
async function solveWithOpenAICompatible({ baseUrl, apiKey, model, questionText, optionsFormatted, images }) {
  if (!baseUrl) {
    throw new Error('Base URL belum diisi untuk provider ini.');
  }

  const systemPrompt = `Anda adalah asisten pemecah soal pilihan ganda akademik akurat.
PENTING: Jawaban Anda HARUS HANYA berupa JSON valid tanpa tanda pembungkus markdown apapun:
{
  "index_jawaban": 0,
  "huruf_jawaban": "A",
  "teks_jawaban": "isi jawaban",
  "alasan": "penjelasan 1 kalimat",
  "confidence": "tinggi"
}
Catatan: "index_jawaban" adalah indeks integer 0-based dari pilihan (A=0, B=1, C=2, D=3).`;

  const userContent = [];
  userContent.push({
    type: 'text',
    text: `SOAL:\n${questionText}\n\nPILIHAN JAWABAN:\n${optionsFormatted}\n\nPilih jawaban paling tepat:`
  });

  if (images && images.length > 0) {
    for (const img of images) {
      if (img.data && img.mimeType) {
        userContent.push({
          type: 'image_url',
          image_url: {
            url: `data:${img.mimeType};base64,${img.data}`
          }
        });
      }
    }
  }

  const payload = {
    model: model || 'deepseek/deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent.length === 1 ? userContent[0].text : userContent }
    ],
    temperature: 0.0,
    max_tokens: 250
  };

  const endpoint = `${baseUrl}/chat/completions`;
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/fidhera/LTenOd',
      'X-Title': 'LTenOd'
    },
    body: JSON.stringify(payload)
  }, 20000);

  const resJson = await response.json();
  if (!response.ok) {
    throw new Error(resJson.error?.message || `HTTP ${response.status}`);
  }

  const rawText = resJson.choices?.[0]?.message?.content;
  if (!rawText) throw new Error('Tidak ada respon teks dari model.');

  return parseJsonResponse(rawText, model);
}

/**
 * Pemecah soal koding (CodeRunner) via OpenAI-Compatible / 9Router
 */
async function solveCodeRunnerWithOpenAICompatible({ baseUrl, apiKey, model, questionText, starterCode, lang, images }) {
  if (!baseUrl) {
    throw new Error('Base URL belum diisi untuk provider ini.');
  }

  const systemPrompt = `Anda adalah programmer expert untuk praktikum pemrograman (${lang || 'Python'}).
Lengkapi seluruh TODO pada starter code yang diberikan sesuai instruksi soal.
PENTING: Output Anda HARUS berupa JSON valid:
{
  "code": "seluruh isi kode program lengkap yang sudah selesai dikerjakan",
  "explanation": "ringkasan singkat penyelesaian"
}`;

  const userContent = [];
  userContent.push({
    type: 'text',
    text: `SOAL DAN INSTRUKSI:\n${questionText}\n\nKODE STARTER:\n\`\`\`${lang || 'python'}\n${starterCode}\n\`\`\`\n\nLengkapi seluruh TODO dan kembalikan kode lengkap:`
  });

  if (images && images.length > 0) {
    for (const img of images) {
      if (img.data && img.mimeType) {
        userContent.push({
          type: 'image_url',
          image_url: {
            url: `data:${img.mimeType};base64,${img.data}`
          }
        });
      }
    }
  }

  const payload = {
    model: model || 'deepseek/deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent.length === 1 ? userContent[0].text : userContent }
    ],
    temperature: 0.1,
    max_tokens: 4096
  };

  const endpoint = `${baseUrl}/chat/completions`;
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/fidhera/LTenOd',
      'X-Title': 'LTenOd'
    },
    body: JSON.stringify(payload)
  }, 35000);

  const resJson = await response.json();
  if (!response.ok) {
    throw new Error(resJson.error?.message || `HTTP ${response.status}`);
  }

  const rawText = resJson.choices?.[0]?.message?.content;
  if (!rawText) throw new Error('Tidak ada respon teks dari model.');

  return parseCodeRunnerResponse(rawText, model);
}

/**
 * Parsing & Sanitasi JSON Pilihan Ganda
 */
function parseJsonResponse(rawText, modelUsed) {
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```json/im, '').replace(/^```/im, '').replace(/```$/im, '').trim();

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    cleaned = match[0];
  }

  try {
    const parsed = JSON.parse(cleaned);
    parsed.modelUsed = modelUsed;
    return parsed;
  } catch (e) {
    throw new Error(`Format output AI tidak valid: ${cleaned.slice(0, 80)}`);
  }
}

/**
 * Parsing & Ekstraksi Solusi Koding CodeRunner
 */
function parseCodeRunnerResponse(rawText, modelUsed) {
  let cleaned = rawText.trim();
  let code = '';
  let explanation = '';

  // 1. Coba parse JSON standard
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
  } catch (e) {
    // Abaikan kegagalan parse JSON
  }

  // 2. Jika kode belum didapat, cari code block ```python ... ```
  if (!code) {
    const blockMatch = rawText.match(/```(?:python3|python|py|c|cpp|java|javascript|js)?\s*([\s\S]*?)```/i);
    if (blockMatch && blockMatch[1].trim()) {
      code = blockMatch[1].trim();
      explanation = 'Kode program diekstrak dari respon model.';
    }
  }

  // 3. Fallback jika output adalah kode mentah
  if (!code) {
    code = cleaned;
    explanation = 'Solusi koding dari AI.';
  }

  return {
    type: 'coderunner',
    code,
    explanation,
    modelUsed,
    confidence: 'Tinggi'
  };
}

/**
 * Deteksi Model & Uji Koneksi untuk Provider Apapun
 */
async function handleDetectModels({ provider, apiKey, baseUrl }) {
  const start = Date.now();
  const cleanKey = apiKey.trim();
  const cleanBase = (baseUrl || '').trim().replace(/\/+$/, '');

  if (!cleanKey) {
    throw new Error('API Key belum diisi.');
  }

  // A. Deteksi untuk Google Gemini Native
  if (provider === 'gemini') {
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`,
      { method: 'GET' },
      8000
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);

    const modelList = (data.models || [])
      .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
      .map(m => m.name.replace('models/', ''));

    const preferred = modelList.find(m => m === 'gemini-3.5-flash-lite')
      || modelList.find(m => m === 'gemini-3.8-flash')
      || modelList.find(m => m === 'gemini-4-argon')
      || modelList.find(m => m.includes('flash-lite'))
      || modelList.find(m => m.includes('flash'))
      || modelList[0]
      || 'gemini-3.5-flash-lite';

    const latency = Date.now() - start;
    return {
      models: modelList,
      activeModel: preferred,
      latency: latency
    };
  }

  // B. Deteksi untuk OpenAI-Compatible (OpenRouter, DeepSeek, Groq, 9Router, dll)
  if (!cleanBase) {
    throw new Error('Base URL wajib diisi untuk provider custom / router.');
  }

  const endpoint = `${cleanBase}/models`;
  const res = await fetchWithTimeout(endpoint, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${cleanKey}`,
      'HTTP-Referer': 'https://github.com/fidhera/LTenOd',
      'X-Title': 'LTenOd'
    }
  }, 10000);

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `HTTP ${res.status}`);
  }

  let modelList = [];
  if (Array.isArray(data.data)) {
    modelList = data.data.map(m => m.id);
  } else if (Array.isArray(data.models)) {
    modelList = data.models.map(m => m.id || m.name || m);
  } else if (Array.isArray(data)) {
    modelList = data.map(m => m.id || m);
  }

  if (modelList.length === 0) {
    throw new Error('Koneksi berhasil tetapi tidak ditemukan model aktif di akun/router ini.');
  }

  const filtered = modelList.filter(id => {
    const s = id.toLowerCase();
    return !s.includes('embed') && !s.includes('whisper') && !s.includes('tts') && !s.includes('dall-e');
  });

  const finalModels = filtered.length > 0 ? filtered : modelList;
  const latency = Date.now() - start;

  return {
    models: finalModels,
    activeModel: finalModels[0],
    latency: latency
  };
}
