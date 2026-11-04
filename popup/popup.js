/**
 * LTenOd - Popup Script (Universal Multi-Provider & Real-time Search)
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
  gemini: 'gemini-3.5-flash-lite',
  openrouter: 'deepseek/deepseek-chat',
  deepseek: 'deepseek-chat',
  groq: 'llama-3.3-70b-versatile',
  openai: 'gpt-4o-mini',
  custom: ''
};

let allAvailableModels = [];

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

  // Muat setting tersimpan
  chrome.storage.local.get([
    'provider', 'baseUrl', 'apiKey', 'activeModel', 'availableModels',
    'lastLatency', 'solveMode', 'minDelay', 'maxDelay', 'audioAlert'
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

    if (data.minDelay) minDelayInput.value = data.minDelay;
    if (data.maxDelay) maxDelayInput.value = data.maxDelay;
    if (typeof data.audioAlert === 'boolean') audioAlertCheckbox.checked = data.audioAlert;

    const mode = data.solveMode || 'auto';
    const radio = document.querySelector(`input[name="solveMode"][value="${mode}"]`);
    if (radio) radio.checked = true;
  });

  // Saat provider diganti
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

  // Live Search Filter untuk Model (Bahkan untuk 900+ model)
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

  // Deteksi & Periksa Model dari Provider / Router
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

  // Simpan Pengaturan
  btnSave.addEventListener('click', () => {
    const provider = providerSelect.value;
    const baseUrl = baseUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const activeModel = modelSelect.value;
    const selectedMode = document.querySelector('input[name="solveMode"]:checked')?.value || 'auto';
    const minDelay = Math.max(1, parseInt(minDelayInput.value, 10) || 1);
    const maxDelay = Math.max(minDelay, parseInt(maxDelayInput.value, 10) || 3);
    const audioAlert = audioAlertCheckbox.checked;

    btnSave.disabled = true;
    btnSave.textContent = 'Menyimpan...';

    chrome.storage.local.set({
      provider,
      baseUrl,
      apiKey,
      activeModel,
      availableModels: allAvailableModels,
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
