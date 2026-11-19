/**
 * LTenOd - Popup Script v1.4
 * Multi-provider, model fallback chain, statistik riwayat, mulai-di-tab-ini.
 */

const PRESET_URLS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1',
  custom: ''
};

const DEFAULT_MODELS = {
  gemini: 'gemini-2.5-flash-lite',
  openrouter: 'deepseek/deepseek-chat',
  deepseek: 'deepseek-chat',
  groq: 'llama-3.3-70b-versatile',
  openai: 'gpt-4o-mini',
  custom: ''
};

let allAvailableModels = [];
let fallbackModels = [];

document.addEventListener('DOMContentLoaded', () => {
  // Beritahu tab aktif untuk menyembunyikan widget sejenak saat popup dibuka
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'hideWidgetTemp' }).catch(() => {});
    }
  });

  const providerSelect = document.getElementById('providerSelect');
  const baseUrlGroup = document.getElementById('baseUrlGroup');
  const baseUrlInput = document.getElementById('baseUrlInput');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const toggleKeyVisibility = document.getElementById('toggleKeyVisibility');
  const btnDetectModels = document.getElementById('btnDetectModels');
  const testStatus = document.getElementById('testStatus');
  const modelCountBadge = document.getElementById('modelCountBadge');
  const modelSearchInput = document.getElementById('modelSearchInput');
  const modelSelect = document.getElementById('modelSelect');
  const latencyDisplay = document.getElementById('latencyDisplay');
  const headerConnection = document.getElementById('headerConnection');
  const minDelayInput = document.getElementById('minDelay');
  const maxDelayInput = document.getElementById('maxDelay');
  const audioAlertCheckbox = document.getElementById('audioAlert');
  const btnSave = document.getElementById('btnSave');
  const saveToast = document.getElementById('saveToast');

  const btnStartHere = document.getElementById('btnStartHere');
  const startStatus = document.getElementById('startStatus');

  const fallbackModelInput = document.getElementById('fallbackModelInput');
  const btnAddFallback = document.getElementById('btnAddFallback');
  const fallbackList = document.getElementById('fallbackList');
  const fallbackCountBadge = document.getElementById('fallbackCountBadge');

  const btnClearHistory = document.getElementById('btnClearHistory');
  const statTotal = document.getElementById('statTotal');
  const statCorrect = document.getElementById('statCorrect');
  const statWrong = document.getElementById('statWrong');
  const statAccuracy = document.getElementById('statAccuracy');
  const statList = document.getElementById('statList');

  /* -------------------- Muat setting tersimpan -------------------- */

  chrome.storage.local.get([
    'provider', 'baseUrl', 'apiKey', 'activeModel', 'availableModels',
    'lastLatency', 'solveMode', 'minDelay', 'maxDelay', 'audioAlert',
    'fallbackModels', 'ltenod_history'
  ], (data) => {
    const provider = data.provider || 'gemini';
    providerSelect.value = provider;
    handleProviderChange(provider, false);

    if (data.baseUrl) baseUrlInput.value = data.baseUrl;
    if (data.apiKey) apiKeyInput.value = data.apiKey;

    if (Array.isArray(data.availableModels) && data.availableModels.length > 0) {
      allAvailableModels = data.availableModels;
      populateModelDropdown(allAvailableModels, data.activeModel);
    } else if (data.activeModel) {
      allAvailableModels = [data.activeModel];
      populateModelDropdown(allAvailableModels, data.activeModel);
    }

    if (data.lastLatency) {
      latencyDisplay.textContent = `${data.lastLatency}ms (${getLatencyGrade(data.lastLatency)})`;
      headerConnection.textContent = 'Terhubung';
      headerConnection.classList.add('connected');
    }

    if (Array.isArray(data.fallbackModels)) {
      fallbackModels = data.fallbackModels;
    }
    renderFallbackList();

    if (data.minDelay) minDelayInput.value = data.minDelay;
    if (data.maxDelay) maxDelayInput.value = data.maxDelay;
    if (typeof data.audioAlert === 'boolean') audioAlertCheckbox.checked = data.audioAlert;

    const mode = data.solveMode || 'auto';
    const radio = document.querySelector(`input[name="solveMode"][value="${mode}"]`);
    if (radio) radio.checked = true;

    renderStats(data.ltenod_history || []);
  });

  /* -------------------- Provider -------------------- */

  providerSelect.addEventListener('change', () => {
    handleProviderChange(providerSelect.value, true);
  });

  function handleProviderChange(provider, autoFillUrl = true) {
    if (provider === 'gemini') {
      baseUrlGroup.style.display = 'none';
      if (autoFillUrl) baseUrlInput.value = PRESET_URLS.gemini;
    } else {
      baseUrlGroup.style.display = 'flex';
      if (autoFillUrl) {
        baseUrlInput.value = PRESET_URLS[provider] || '';
        if (provider === 'custom') {
          baseUrlInput.placeholder = 'https://router.domain.com/v1';
        }
      }
    }

    if (autoFillUrl && DEFAULT_MODELS[provider]) {
      allAvailableModels = [DEFAULT_MODELS[provider]];
      populateModelDropdown(allAvailableModels, DEFAULT_MODELS[provider]);
    }
  }

  // Toggle visibilitas API key
  toggleKeyVisibility.addEventListener('click', () => {
    const isPass = apiKeyInput.type === 'password';
    apiKeyInput.type = isPass ? 'text' : 'password';
    toggleKeyVisibility.textContent = isPass ? 'Sembunyikan' : 'Perlihatkan';
  });

  /* -------------------- Live search model -------------------- */

  modelSearchInput.addEventListener('input', () => {
    const query = modelSearchInput.value.trim().toLowerCase();
    const currentSelected = modelSelect.value;
    if (!query) {
      populateModelDropdown(allAvailableModels, currentSelected);
      return;
    }

    const filtered = allAvailableModels.filter(m => m.toLowerCase().includes(query));
    populateModelDropdown(filtered, currentSelected);
  });

  /* -------------------- Deteksi model -------------------- */

  btnDetectModels.addEventListener('click', () => {
    const provider = providerSelect.value;
    const apiKey = apiKeyInput.value.trim();
    const baseUrl = baseUrlInput.value.trim();

    if (!apiKey) {
      testStatus.textContent = 'API Key belum diisi';
      testStatus.className = 'status-indicator error';
      return;
    }

    if (provider !== 'gemini' && !baseUrl) {
      testStatus.textContent = 'Base URL belum diisi';
      testStatus.className = 'status-indicator error';
      return;
    }

    testStatus.textContent = 'Mengambil semua model...';
    testStatus.className = 'status-indicator';
    btnDetectModels.disabled = true;

    chrome.runtime.sendMessage({
      action: 'testAndDetectModels',
      config: { provider, apiKey, baseUrl }
    }, (res) => {
      btnDetectModels.disabled = false;

      if (chrome.runtime.lastError) {
        testStatus.textContent = 'Muat ulang ekstensi dahulu';
        testStatus.className = 'status-indicator error';
        return;
      }

      if (res && res.success) {
        allAvailableModels = res.models;
        testStatus.textContent = `${allAvailableModels.length} model aktif`;
        testStatus.className = 'status-indicator ok';
        latencyDisplay.textContent = `${res.latency}ms (${getLatencyGrade(res.latency)})`;
        headerConnection.textContent = 'Terhubung';
        headerConnection.classList.add('connected');

        modelSearchInput.value = '';
        populateModelDropdown(allAvailableModels, res.activeModel);

        chrome.storage.local.set({
          availableModels: allAvailableModels,
          activeModel: res.activeModel,
          lastLatency: res.latency
        });
      } else {
        const err = res && res.error ? res.error : 'Koneksi gagal';
        testStatus.textContent = err.length > 25 ? err.slice(0, 22) + '...' : err;
        testStatus.className = 'status-indicator error';
        testStatus.title = err;
      }
    });
  });

  function populateModelDropdown(models, selectedModel) {
    modelSelect.innerHTML = '';
    modelCountBadge.textContent = `${models.length} model`;

    if (models.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Tidak ada model yang cocok';
      modelSelect.appendChild(opt);
      return;
    }

    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      if (m === selectedModel) opt.selected = true;
      modelSelect.appendChild(opt);
    });

    // Jika yang terpilih sebelumnya tidak ada di filter baru, set ke item pertama
    if (!models.includes(modelSelect.value)) {
      modelSelect.value = models[0];
    }
  }

  /* -------------------- Model cadangan (fallback) -------------------- */

  btnAddFallback.addEventListener('click', () => {
    const raw = fallbackModelInput.value.trim();
    if (!raw) return;

    // Dukung format "provider|model" untuk fallback lintas provider
    let provider = providerSelect.value;
    let model = raw;
    if (raw.includes('|')) {
      const [p, m] = raw.split('|', 2);
      if (p && m) {
        provider = p.trim();
        model = m.trim();
      }
    }

    if (fallbackModels.some(f => f.model === model && f.provider === provider)) {
      fallbackModelInput.value = '';
      return;
    }

    fallbackModels.push({
      provider,
      model,
      baseUrl: provider === 'gemini' ? '' : (PRESET_URLS[provider] || baseUrlInput.value.trim()),
      apiKey: ''
    });

    fallbackModelInput.value = '';
    renderFallbackList();
  });

  fallbackModelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btnAddFallback.click();
    }
  });

  function renderFallbackList() {
    fallbackList.innerHTML = '';
    fallbackCountBadge.textContent = `${fallbackModels.length} cadangan`;

    if (fallbackModels.length === 0) {
      const li = document.createElement('li');
      li.className = 'fallback-empty';
      li.textContent = 'Belum ada model cadangan. Contoh isi: gemini-2.5-flash atau openrouter|deepseek/deepseek-chat';
      fallbackList.appendChild(li);
      return;
    }

    fallbackModels.forEach((fb, idx) => {
      const li = document.createElement('li');

      const name = document.createElement('span');
      name.className = 'fb-name';
      name.textContent = fb.provider === providerSelect.value ? fb.model : `${fb.provider} | ${fb.model}`;
      name.title = `${fb.provider} | ${fb.model}`;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'fb-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Hapus cadangan ${fb.model}`);
      remove.addEventListener('click', () => {
        fallbackModels.splice(idx, 1);
        renderFallbackList();
      });

      li.append(name, remove);
      fallbackList.appendChild(li);
    });
  }

  /* -------------------- Mulai di tab ini -------------------- */

  btnStartHere.addEventListener('click', () => {
    startStatus.className = 'start-status visible';
    startStatus.textContent = 'Memeriksa halaman aktif...';
    btnStartHere.disabled = true;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) {
        showStartStatus('Tidak menemukan tab aktif.', 'err');
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: 'ping' }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) {
          showStartStatus('Ekstensi tidak aktif di tab ini. Buka halaman kuis Moodle/Gunadarma dulu.', 'err');
          return;
        }
        if (!res.quizPage) {
          showStartStatus('Tab ini bukan halaman soal kuis. Buka halaman soal dulu.', 'err');
          return;
        }

        chrome.tabs.sendMessage(tab.id, { action: 'startSolve' }, () => {
          if (chrome.runtime.lastError) {
            showStartStatus('Gagal memulai. Coba muat ulang halaman kuis.', 'err');
            return;
          }
          showStartStatus('Auto-solve dimulai. Lihat widget di halaman.', 'ok');
          setTimeout(() => window.close(), 600);
        });
      });
    });
  });

  function showStartStatus(text, kind) {
    startStatus.className = `start-status visible ${kind}`;
    startStatus.textContent = text;
    btnStartHere.disabled = false;
  }

  /* -------------------- Statistik & riwayat -------------------- */

  btnClearHistory.addEventListener('click', () => {
    chrome.storage.local.set({ ltenod_history: [] }, () => renderStats([]));
  });

  function renderStats(history) {
    const total = history.length;
    const correct = history.filter(h => h.status === 'correct').length;
    const wrong = history.filter(h => h.status === 'wrong').length;
    const answered = correct + wrong;
    const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;

    statTotal.textContent = String(total);
    statCorrect.textContent = String(correct);
    statWrong.textContent = String(wrong);
    statAccuracy.textContent = `${accuracy}%`;

    statList.innerHTML = '';

    if (total === 0) {
      const li = document.createElement('li');
      li.className = 'history-empty';
      li.textContent = 'Belum ada riwayat. Riwayat terisi setelah ekstensi menjawab soal.';
      statList.appendChild(li);
      return;
    }

    history.slice(0, 10).forEach((h) => {
      const li = document.createElement('li');

      const dot = document.createElement('span');
      dot.className = `h-dot ${h.status || 'pending'}`;
      dot.title = h.status || 'pending';

      const q = document.createElement('span');
      const qText = (h.question || '').replace(/\s+/g, ' ').trim();
      q.textContent = qText.length > 34 ? qText.slice(0, 34) + '...' : (qText || '(soal kosong)');
      q.title = qText;

      const model = document.createElement('span');
      model.className = 'h-model';
      model.textContent = h.model || '';
      model.title = h.model || '';

      li.append(dot, q, model);
      statList.appendChild(li);
    });
  }

  /* -------------------- Simpan pengaturan -------------------- */

  btnSave.addEventListener('click', () => {
    const provider = providerSelect.value;
    const baseUrl = baseUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const activeModel = modelSelect.value;
    const selectedMode = document.querySelector('input[name="solveMode"]:checked')?.value || 'auto';
    const minDelay = Math.max(1, parseInt(minDelayInput.value, 10) || 1);
    const maxDelay = Math.max(minDelay, parseInt(maxDelayInput.value, 10) || 3);
    const audioAlert = audioAlertCheckbox.checked;

    const doSave = () => {
      btnSave.disabled = true;
      btnSave.textContent = 'Menyimpan...';

      chrome.storage.local.set({
        provider,
        baseUrl,
        apiKey,
        activeModel,
        availableModels: allAvailableModels,
        fallbackModels,
        solveMode: selectedMode,
        minDelay,
        maxDelay,
        audioAlert
      }, () => {
        // Kirim sinyal ke tab aktif untuk menampilkan dan me-refresh widget
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'showAndRefreshWidget',
              config: {
                provider,
                activeModel,
                solveMode: selectedMode,
                minDelay,
                maxDelay
              }
            }).catch(() => {});
          }
        });

        // Tampilkan notifikasi singkat lalu segera tutup popup
        saveToast.style.display = 'block';
        setTimeout(() => {
          window.close();
        }, 150);
      });
    };

    // Provider kustom butuh izin host runtime untuk origin base URL
    if (provider === 'custom' && baseUrl) {
      let origin;
      try {
        origin = new URL(baseUrl).origin + '/*';
      } catch {
        startStatus.className = 'start-status visible err';
        startStatus.textContent = 'Base URL tidak valid. Perbaiki formatnya.';
        return;
      }

      chrome.permissions.request({ origins: [origin] }, (granted) => {
        if (granted) {
          doSave();
        } else {
          startStatus.className = 'start-status visible err';
          startStatus.textContent = 'Izin domain ditolak. Panggilan API ke domain itu akan gagal sampai izin diberikan.';
        }
      });
      return;
    }

    doSave();
  });

  // Jika popup ditutup tanpa klik simpan (misal klik di luar area popup)
  window.addEventListener('pagehide', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'restoreWidget' }).catch(() => {});
      }
    });
  });

  function getLatencyGrade(ms) {
    if (ms < 350) return 'Sangat Cepat';
    if (ms < 900) return 'Normal';
    return 'Lambat';
  }
});
