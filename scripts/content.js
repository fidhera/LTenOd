/**
 * LTenOd - Content Script (Fast & Bulletproof Engine)
 * Fitur:
 * 1. Pencegahan Double Submit (Fix error 'entered data outside normal sequence')
 * 2. Auto-Recovery untuk Halaman Error Moodle ('Continue' Button Auto-Click)
 * 3. Continuous Auto-Solve Tanpa Flapping Button
 * 4. Pilihan Model Fleksibel (Gemini, OpenRouter, DeepSeek, 9Router, dll)
 * 5. Window Draggable, Resizable & Stealth Mode (Alt + H)
 */

(function () {
  'use strict';

  if (window.__LTEN_OD_LOADED__) return;
  window.__LTEN_OD_LOADED__ = true;

  const adapter = getActiveAdapter();
  if (!adapter) {
    return;
  }

  let currentSettings = {
    solveMode: 'auto',
    minDelay: 1,
    maxDelay: 3,
    audioAlert: true,
    activeModel: 'gemini-3.5-flash-lite',
    provider: 'gemini'
  };

  let activeCountdownTimer = null;
  let isNavigating = false;
  let retryCount = 0;
  let consecutiveTimeoutCount = 0;
  const MAX_TIMEOUT_RETRIES = 2; // Total 3x percobaan (1 request awal + 2 retry)

  // Muat setting awal
  chrome.storage.local.get(['solveMode', 'minDelay', 'maxDelay', 'audioAlert', 'activeModel', 'provider'], (res) => {
    if (res.solveMode) currentSettings.solveMode = res.solveMode;
    if (res.minDelay) currentSettings.minDelay = res.minDelay;
    if (res.maxDelay) currentSettings.maxDelay = res.maxDelay;
    if (typeof res.audioAlert === 'boolean') currentSettings.audioAlert = res.audioAlert;
    if (res.activeModel) currentSettings.activeModel = res.activeModel;
    if (res.provider) currentSettings.provider = res.provider;
    updateWidgetState();

    // Cek auto recovery jika berada di halaman error 'Continue' Moodle
    if (checkMoodleErrorOrContinuePage()) {
      return;
    }

    checkContinuousAutoRun();
  });

  // Sinkronisasi dinamis dari popup
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.solveMode) currentSettings.solveMode = changes.solveMode.newValue;
      if (changes.minDelay) currentSettings.minDelay = changes.minDelay.newValue;
      if (changes.maxDelay) currentSettings.maxDelay = changes.maxDelay.newValue;
      if (changes.audioAlert) currentSettings.audioAlert = changes.audioAlert.newValue;
      if (changes.activeModel) currentSettings.activeModel = changes.activeModel.newValue;
      if (changes.provider) currentSettings.provider = changes.provider.newValue;
      updateWidgetState();
    }
  });

  // Komunikasi real-time dari popup extension (transisi hide/show & instant refresh)
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const widget = document.getElementById('ltensolver-widget');
    if (!widget) return;

    if (msg.action === 'hideWidgetTemp') {
      widget.classList.add('is-popup-open');
    } else if (msg.action === 'restoreWidget') {
      widget.classList.remove('is-popup-open');
    } else if (msg.action === 'showAndRefreshWidget') {
      widget.classList.remove('is-popup-open');
      hideErrorDiagnostic();

      if (msg.config) {
        if (msg.config.solveMode) currentSettings.solveMode = msg.config.solveMode;
        if (msg.config.minDelay) currentSettings.minDelay = msg.config.minDelay;
        if (msg.config.maxDelay) currentSettings.maxDelay = msg.config.maxDelay;
        if (msg.config.activeModel) currentSettings.activeModel = msg.config.activeModel;
        if (msg.config.provider) currentSettings.provider = msg.config.provider;
      }

      updateWidgetState();
      updateWidgetButton(false);

      const footerStatus = document.getElementById('ltensolver-footer-status');
      if (footerStatus) {
        footerStatus.textContent = 'Konfigurasi aktif. Siap digunakan.';
        footerStatus.style.color = '#34d399';
      }
    }
  });

  createFloatingWidget();

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      handlePrimaryButtonClick();
    }
    if (e.altKey && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      toggleWidgetVisibility();
    }
  });

  setupMutationObserver();

  /**
   * Cek Halaman Error Moodle "Outside the normal sequence"
   * Otomatis klik tombol Continue untuk memulihkan sesi ujian
   */
  function checkMoodleErrorOrContinuePage() {
    const continueBtn = document.querySelector('.continuebutton button, .continuebutton input[type="submit"], form[action*="attempt.php"] button[type="submit"]');
    const hasErrorMessage = document.querySelector('.errorbox, .errormessage, [data-rel="fatalerror"]');

    if (continueBtn && hasErrorMessage) {
      const footerStatus = document.getElementById('ltensolver-footer-status');
      if (footerStatus) {
        footerStatus.textContent = 'Memulihkan sesi kuis (Auto Continue)...';
        footerStatus.style.color = '#f59e0b';
      }
      setTimeout(() => {
        continueBtn.click();
      }, 400);
      return true;
    }
    return false;
  }

  /**
   * Cek apakah Continuous Auto-Solve aktif dari halaman sebelumnya
   */
  function checkContinuousAutoRun() {
    const isAutoActive = sessionStorage.getItem('ltensolver_auto_active') === 'true';
    if (isAutoActive && currentSettings.solveMode === 'auto') {
      updateWidgetButton(true);
      const footerStatus = document.getElementById('ltensolver-footer-status');
      if (footerStatus) {
        footerStatus.textContent = 'Membaca soal...';
        footerStatus.style.color = '#60a5fa';
      }

      setTimeout(() => {
        if (sessionStorage.getItem('ltensolver_auto_active') === 'true') {
          triggerSolveProcess();
        }
      }, 350);
    } else {
      updateWidgetButton(false);
    }
  }

  /**
   * Buat Floating Action Window UI
   */
  function createFloatingWidget() {
    const existing = document.getElementById('ltensolver-widget');
    if (existing) existing.remove();

    const widget = document.createElement('div');
    widget.id = 'ltensolver-widget';
    widget.className = 'ltensolver-widget';

    widget.innerHTML = `
      <div class="ltensolver-header" id="ltensolver-drag-handle">
        <div class="ltensolver-title-group">
          <span class="ltensolver-status-dot" id="ltensolver-dot"></span>
          <span class="ltensolver-title">LTenOd</span>
          <span class="ltensolver-mode-pill" id="ltensolver-mode-pill">Otomatis</span>
        </div>
        <div class="ltensolver-window-actions">
          <button class="ltensolver-win-btn" id="ltensolver-btn-min" title="Kecilkan / Perbesar">–</button>
          <button class="ltensolver-win-btn" id="ltensolver-btn-close" title="Sembunyikan (Alt+H)">×</button>
        </div>
      </div>
      <div class="ltensolver-body" id="ltensolver-body">
        <div class="ltensolver-model-bar" id="ltensolver-model-bar" title="Model AI yang digunakan">
          <span class="ltensolver-model-prefix">Model</span>
          <span class="ltensolver-model-badge" id="ltensolver-widget-model">gemini-3.5-flash-lite</span>
        </div>

        <button class="ltensolver-btn-primary" id="ltensolver-btn-solve">
          <span id="ltensolver-btn-text">Pecahkan Soal (Alt+S)</span>
        </button>

        <div class="ltensolver-error-banner" id="ltensolver-error-banner" style="display: none;"></div>

        <div class="ltensolver-result-box" id="ltensolver-result-box" style="display: none;">
          <div class="ltensolver-result-header">
            <strong id="ltensolver-result-choice">Jawaban: -</strong>
            <span class="ltensolver-confidence-badge" id="ltensolver-result-conf">Tinggi</span>
          </div>
          <div class="ltensolver-result-desc" id="ltensolver-result-desc"></div>
        </div>

        <div class="ltensolver-guard-banner" id="ltensolver-finish-guard-banner" style="display: none;"></div>

        <div class="ltensolver-footer" id="ltensolver-footer-status">
          Tekan Alt + S
        </div>
      </div>
    `;

    document.body.appendChild(widget);

    updateWidgetState();

    const btnSolve = widget.querySelector('#ltensolver-btn-solve');
    btnSolve.addEventListener('click', handlePrimaryButtonClick);

    const btnMin = widget.querySelector('#ltensolver-btn-min');
    btnMin.addEventListener('click', () => {
      const isMin = widget.classList.toggle('is-minimized');
      btnMin.textContent = isMin ? '+' : '–';
    });

    const btnClose = widget.querySelector('#ltensolver-btn-close');
    btnClose.addEventListener('click', toggleWidgetVisibility);

    setupWindowDragging(widget, widget.querySelector('#ltensolver-drag-handle'));
  }

  function handlePrimaryButtonClick() {
    const isAutoActive = sessionStorage.getItem('ltensolver_auto_active') === 'true';

    if (isAutoActive) {
      stopAutoLoop('Pengerjaan otomatis dijeda.');
      return;
    }

    if (currentSettings.solveMode === 'auto') {
      sessionStorage.setItem('ltensolver_auto_active', 'true');
      updateWidgetButton(true);
    }

    retryCount = 0;
    triggerSolveProcess();
  }

  function stopAutoLoop(message = 'Otomatisasi dijeda.') {
    sessionStorage.removeItem('ltensolver_auto_active');
    if (activeCountdownTimer) {
      clearInterval(activeCountdownTimer);
      activeCountdownTimer = null;
    }
    updateWidgetButton(false);
    const footerStatus = document.getElementById('ltensolver-footer-status');
    if (footerStatus) {
      footerStatus.textContent = message;
      footerStatus.style.color = '#94a3b8';
    }
  }

  function updateWidgetButton(isRunning) {
    const btn = document.getElementById('ltensolver-btn-solve');
    const text = document.getElementById('ltensolver-btn-text');
    const dot = document.getElementById('ltensolver-dot');
    if (!btn || !text) return;

    if (isRunning) {
      btn.className = 'ltensolver-btn-stop';
      text.textContent = 'Hentikan Auto-Solve (Alt+S)';
      if (dot) dot.className = 'ltensolver-status-dot active';
    } else {
      btn.className = 'ltensolver-btn-primary';
      text.textContent = currentSettings.solveMode === 'auto' ? 'Mulai Auto-Solve (Alt+S)' : 'Pecahkan Soal (Alt+S)';
      if (dot) dot.className = 'ltensolver-status-dot';
    }
  }

  function updateWidgetState() {
    const pill = document.getElementById('ltensolver-mode-pill');
    if (pill) {
      const isAuto = currentSettings.solveMode === 'auto';
      pill.textContent = isAuto ? 'Otomatis' : 'Highlight';
      pill.className = `ltensolver-mode-pill ${isAuto ? 'auto' : 'highlight'}`;
    }

    const modelBadge = document.getElementById('ltensolver-widget-model');
    if (modelBadge) {
      modelBadge.textContent = currentSettings.activeModel || 'gemini-3.5-flash-lite';
      modelBadge.title = `Model aktif: ${currentSettings.activeModel || 'Default'}`;
    }

    const isRunning = sessionStorage.getItem('ltensolver_auto_active') === 'true';
    updateWidgetButton(isRunning);
  }

  function toggleWidgetVisibility() {
    const widget = document.getElementById('ltensolver-widget');
    if (!widget) return;
    widget.classList.toggle('is-hidden');
  }

  function setupWindowDragging(widget, handle) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ltensolver-window-actions')) return;

      isDragging = true;
      widget.classList.add('is-dragging');

      const rect = widget.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = rect.left;
      initialTop = rect.top;

      widget.style.right = 'auto';
      widget.style.bottom = 'auto';
      widget.style.left = `${initialLeft}px`;
      widget.style.top = `${initialTop}px`;

      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      let newLeft = initialLeft + (e.clientX - startX);
      let newTop = initialTop + (e.clientY - startY);

      const maxLeft = window.innerWidth - widget.offsetWidth;
      const maxTop = window.innerHeight - widget.offsetHeight;

      newLeft = Math.max(10, Math.min(newLeft, maxLeft - 10));
      newTop = Math.max(10, Math.min(newTop, maxTop - 10));

      widget.style.left = `${newLeft}px`;
      widget.style.top = `${newTop}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        widget.classList.remove('is-dragging');
      }
    });
  }

  /**
   * Eksekusi pemecahan soal cepat
   */
  async function triggerSolveProcess() {
    const btnSolve = document.getElementById('ltensolver-btn-solve');
    const footerStatus = document.getElementById('ltensolver-footer-status');

    // Cek tombol continue error Moodle jika ada
    if (checkMoodleErrorOrContinuePage()) {
      return;
    }

    if (btnSolve.classList.contains('loading')) return;
    btnSolve.classList.add('loading');
    hideErrorDiagnostic();

    const finishBanner = document.getElementById('ltensolver-finish-guard-banner');
    if (finishBanner) finishBanner.style.display = 'none';

    footerStatus.textContent = 'Membaca soal...';
    footerStatus.style.color = '#94a3b8';

    try {
      const questionData = await extractQuestionData();
      if (!questionData) {
        // Cek apakah sedang berada di halaman summary attempt Moodle
        if (document.querySelector('.quizsummaryofattempt, .summarycomputertable, form[action*="processattempt"] input[value*="Submit all"]')) {
          stopAutoLoop('Semua soal telah selesai dikerjakan.');
          if (finishBanner) {
            finishBanner.style.display = 'block';
            finishBanner.innerHTML = `
              <b>Ringkasan Kuis Moodle</b><br>
              Semua soal telah terjawab. Periksa kembali status jawaban lalu klik <strong>Submit all and finish</strong> secara manual.
            `;
          }
          btnSolve.classList.remove('loading');
          footerStatus.textContent = 'Kuis selesai. Silakan kumpulkan.';
          footerStatus.style.color = '#34d399';
          return;
        }

        // Jika DOM belum siap (misal transisi SPA), coba lagi hingga 3x
        if (retryCount < 3) {
          retryCount++;
          btnSolve.classList.remove('loading');
          footerStatus.textContent = `Menunggu soal (${retryCount}/3)...`;
          setTimeout(() => triggerSolveProcess(), 500);
          return;
        }
        throw new Error('Tidak menemukan kontainer soal aktif pada halaman ini.');
      }

      retryCount = 0;
      footerStatus.textContent = 'Menganalisis jawaban via AI...';

      chrome.runtime.sendMessage(
        { action: 'solveQuestion', data: questionData },
        async (response) => {
          btnSolve.classList.remove('loading');

          if (!response || !response.success) {
            const rawErr = response ? response.error : 'Koneksi gagal atau tidak ada respons.';
            const s = String(rawErr || '').toLowerCase();
            const isAutoRunning = sessionStorage.getItem('ltensolver_auto_active') === 'true';
            const isRetryable = s.includes('timeout') || s.includes('504') || s.includes('503') || s.includes('502') || s.includes('aborted');

            // Autonomous Auto-Retry: coba lagi otomatis tanpa memutus auto loop
            if (isAutoRunning && isRetryable && consecutiveTimeoutCount < MAX_TIMEOUT_RETRIES) {
              consecutiveTimeoutCount++;
              footerStatus.textContent = `Koneksi lambat, mencoba ulang otomatis (${consecutiveTimeoutCount}/${MAX_TIMEOUT_RETRIES})...`;
              footerStatus.style.color = '#f59e0b';

              setTimeout(() => {
                if (sessionStorage.getItem('ltensolver_auto_active') === 'true') {
                  triggerSolveProcess();
                }
              }, 1200);
              return;
            }

            consecutiveTimeoutCount = 0;
            showErrorDiagnostic(rawErr);
            stopAutoLoop('Gagal memproses soal.');
            return;
          }

          consecutiveTimeoutCount = 0;
          hideErrorDiagnostic();
          const res = response.result;
          displayResult(res);
          await applyAnswer(questionData, res);
        }
      );

    } catch (err) {
      btnSolve.classList.remove('loading');
      showErrorDiagnostic(err.message);
      stopAutoLoop('Terjadi kesalahan.');
    }
  }

  function showErrorDiagnostic(rawErr) {
    const errorBox = document.getElementById('ltensolver-error-banner');
    const footerStatus = document.getElementById('ltensolver-footer-status');
    const resultBox = document.getElementById('ltensolver-result-box');

    if (resultBox) resultBox.style.display = 'none';

    let title = 'Gagal Memproses Soal';
    let desc = rawErr;
    let advice = 'Periksa konfigurasi di popup ekstensi.';

    const s = String(rawErr || '').toLowerCase();
    if (s.includes('429') || s.includes('quota') || s.includes('rate limit')) {
      title = 'Kuota / Token Habis (HTTP 429)';
      desc = 'Batas kuota token atau rate limit akun provider Anda telah tercapai.';
      advice = 'Solusi: Cek saldo token atau ganti provider/model lain via popup ekstensi.';
    } else if (s.includes('401') || s.includes('403') || s.includes('unauthorized') || s.includes('invalid api key')) {
      title = 'API Key Tidak Valid (HTTP 401/403)';
      desc = 'Kredensial API Key ditolak oleh provider AI.';
      advice = 'Solusi: Buka popup ekstensi dan masukkan API Key yang sesuai.';
    } else if (s.includes('404') || s.includes('not found')) {
      title = 'Model Tidak Ditemukan (HTTP 404)';
      desc = 'Model yang dipilih tidak tersedia pada akun atau endpoint provider ini.';
      advice = 'Solusi: Buka popup ekstensi, klik "Deteksi & Periksa Model", lalu pilih model yang aktif.';
    } else if (s.includes('timeout') || s.includes('aborted') || s.includes('504')) {
      title = 'Koneksi Timeout (>20s)';
      desc = 'Server AI atau koneksi internet terlalu lambat merespons permintaan.';
      advice = 'Solusi: Ekstensi telah mencoba ulang otomatis namun server provider sedang overload. Coba gunakan model yang lebih ringan.';
    } else if (s.includes('500') || s.includes('502') || s.includes('503')) {
      title = 'Server Provider Gangguan';
      desc = `Server API sedang mengalami masalah (${rawErr}).`;
      advice = 'Solusi: Tunggu sesaat atau gunakan model/provider cadangan.';
    }

    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.innerHTML = `
        <div class="ltensolver-error-title">${title}</div>
        <div class="ltensolver-error-desc">${desc}</div>
        <div class="ltensolver-error-advice">${advice}</div>
      `;
    }

    if (footerStatus) {
      footerStatus.textContent = title;
      footerStatus.style.color = '#f87171';
    }
  }

  function hideErrorDiagnostic() {
    const errorBox = document.getElementById('ltensolver-error-banner');
    if (errorBox) {
      errorBox.style.display = 'none';
      errorBox.innerHTML = '';
    }
  }

  function checkAutoSubmitGuard() {
    stopAutoLoop('Semua soal telah selesai.');
    playChimeSound(660);

    const finishBanner = document.getElementById('ltensolver-finish-guard-banner');
    if (finishBanner) {
      finishBanner.style.display = 'block';
      finishBanner.innerHTML = `
        <b>🎉 Semua Soal Telah Selesai Dijawab!</b><br>
        Periksa kembali jawaban Anda, lalu kumpulkan kuis secara manual.
      `;
    }

    const footerStatus = document.getElementById('ltensolver-footer-status');
    if (footerStatus) {
      footerStatus.textContent = 'Kuis selesai. Silakan periksa & kumpulkan.';
      footerStatus.style.color = '#34d399';
    }
    return true;
  }

  async function extractQuestionData() {
    const qContainer = document.querySelector(adapter.questionContainer);
    if (!qContainer) return null;

    const qTextEl = qContainer.querySelector(adapter.questionText);
    const questionText = qTextEl ? qTextEl.innerText.trim() : '';

    const imgElements = qContainer.querySelectorAll(adapter.questionImages);
    const images = [];
    for (const img of imgElements) {
      if (img.src && !img.src.includes('theme/image.php') && !img.src.includes('pix.php')) {
        try {
          const base64Data = await convertImageToBase64(img.src);
          if (base64Data) images.push(base64Data);
        } catch {
          // Lewati jika gagal
        }
      }
    }

    const optionEls = qContainer.querySelectorAll(adapter.optionItems);
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const options = [];

    optionEls.forEach((el) => {
      if (el.classList.contains('qtype_multichoice_clearchoice')) return;

      const labelEl = el.querySelector(adapter.optionLabel) || el;
      const inputEl = el.querySelector(adapter.optionInput);

      let text = labelEl.innerText.trim();
      text = text.replace(/^[a-eA-E][.)\s-]+/, '').trim();

      options.push({
        index: options.length,
        letter: letters[options.length] || `Opt${options.length + 1}`,
        text: text,
        element: el,
        inputElement: inputEl
      });
    });

    return {
      container: qContainer,
      questionText,
      options,
      images
    };
  }

  async function applyAnswer(questionData, result) {
    const footerStatus = document.getElementById('ltensolver-footer-status');
    const targetIndex = result.index_jawaban;
    const targetOption = questionData.options[targetIndex] || questionData.options.find(
      opt => opt.letter.toUpperCase() === String(result.huruf_jawaban).toUpperCase()
    );

    if (!targetOption) {
      footerStatus.textContent = `Opsi ${result.huruf_jawaban} tidak ditemukan.`;
      footerStatus.style.color = '#f87171';
      stopAutoLoop();
      return;
    }

    // Bersihkan highlight lama
    document.querySelectorAll('.ltensolver-highlighted-choice').forEach(el => {
      el.classList.remove('ltensolver-highlighted-choice');
      const badge = el.querySelector('.ltensolver-choice-badge');
      if (badge) badge.remove();
    });

    const el = targetOption.element;
    el.classList.add('ltensolver-highlighted-choice');
    const badge = document.createElement('span');
    badge.className = 'ltensolver-choice-badge';
    badge.textContent = `Pilihan: ${result.huruf_jawaban}`;
    el.appendChild(badge);

    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Langsung centang opsi
    selectOptionReliably(targetOption);

    // Cek apakah ini soal terakhir (Tombol navigasi bertuliskan "Finish attempt ..." atau tidak ada tombol Next)
    const nextBtn = findStrictNextButton();
    const isFinishStep = !nextBtn || (
      (nextBtn.value || '').toLowerCase().includes('finish') ||
      (nextBtn.value || '').toLowerCase().includes('selesai')
    );

    if (isFinishStep) {
      stopAutoLoop('Semua soal telah selesai dijawab.');
      playChimeSound(660);

      const finishBanner = document.getElementById('ltensolver-finish-guard-banner');
      if (finishBanner) {
        finishBanner.style.display = 'block';
        finishBanner.innerHTML = `
          <b>🎉 Semua Soal Telah Selesai Dijawab!</b><br>
          Jawaban soal terakhir (<strong>${result.huruf_jawaban}</strong>) telah dipilih dan dicentang. Ekstensi menahan auto-submit agar Anda dapat memeriksa jawaban. Klik <strong>Finish attempt</strong> di bawah untuk mengumpulkan kuis.
        `;
      }

      footerStatus.textContent = 'Kuis selesai. Silakan periksa & kumpulkan.';
      footerStatus.style.color = '#34d399';
      return;
    }

    // Mode Otomatis (Lepas Tangan Penuh - Tanpa Jeda Ragu)
    if (currentSettings.solveMode === 'auto') {
      const minD = Math.max(1, currentSettings.minDelay);
      const maxD = Math.max(minD, currentSettings.maxDelay);
      const delaySec = Math.floor(Math.random() * (maxD - minD + 1) + minD);

      let timeLeft = delaySec;
      footerStatus.textContent = `Lanjut otomatis dalam ${timeLeft}s...`;
      footerStatus.style.color = '#34d399';

      if (activeCountdownTimer) clearInterval(activeCountdownTimer);

      activeCountdownTimer = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
          footerStatus.textContent = `Lanjut otomatis dalam ${timeLeft}s...`;
        } else {
          clearInterval(activeCountdownTimer);
          activeCountdownTimer = null;
          executeNextPageClick();
        }
      }, 1000);

    } else {
      footerStatus.textContent = `Opsi ${result.huruf_jawaban} ditandai (Highlight Mode)`;
      footerStatus.style.color = '#34d399';
    }
  }

  /**
   * PENCEGAHAN DOUBLE SUBMIT:
   * Hanya melakukan klik satu kali pada tombol submit Moodle dan mengunci navigasi
   * sampai halaman baru termuat. TIDAK PERNAH memanggil requestSubmit() cadangan
   * yang dapat merusak sequence Moodle.
   */
  function executeNextPageClick() {
    if (isNavigating) return;

    const footerStatus = document.getElementById('ltensolver-footer-status');
    const nextBtn = findStrictNextButton();

    if (nextBtn) {
      isNavigating = true;
      if (footerStatus) footerStatus.textContent = 'Membuka soal berikutnya...';

      nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Dispatch mousedown, mouseup, dan click TEPAT SATU KALI
      nextBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      nextBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      nextBtn.click();

      // Reset guard setelah 2.5 detik jika halaman tidak kunjung berpindah
      setTimeout(() => {
        isNavigating = false;
      }, 2500);

    } else {
      checkAutoSubmitGuard();
    }
  }

  function findStrictNextButton() {
    const exactId = document.getElementById('mod_quiz-next-nav');
    if (exactId && isRealNextButton(exactId)) {
      return exactId;
    }

    const elements = document.querySelectorAll(
      'input[name="next"], button[name="next"], input.mod_quiz-next-nav, button.mod_quiz-next-nav, .submitbtns input, .submitbtns button, input[type="submit"]'
    );

    for (const el of elements) {
      if (isRealNextButton(el)) {
        return el;
      }
    }
    return null;
  }

  function isRealNextButton(el) {
    if (!el) return false;
    const name = (el.name || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const className = (el.className || '').toLowerCase();
    const value = (el.value || el.innerText || '').toLowerCase();

    // Tolak tombol previous
    if (name === 'previous' || id.includes('prev') || className.includes('prev') || value.includes('previous') || value.includes('kembali')) {
      return false;
    }

    // Tolak tombol check single
    if (id.includes('-submit') && !id.includes('next')) {
      return false;
    }

    // Cocok dengan next
    if (name === 'next' || id === 'mod_quiz-next-nav' || className.includes('mod_quiz-next-nav') || value.includes('next') || value.includes('selanjutnya')) {
      return true;
    }

    return false;
  }

  function selectOptionReliably(targetOption) {
    const input = targetOption.inputElement;
    if (input) {
      input.checked = true;
      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      input.click();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const label = targetOption.element.querySelector('[data-region="answer-label"], label') || targetOption.element;
    if (label && label !== input) {
      label.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
  }

  function displayResult(result) {
    const resultBox = document.getElementById('ltensolver-result-box');
    const choiceEl = document.getElementById('ltensolver-result-choice');
    const confEl = document.getElementById('ltensolver-result-conf');
    const descEl = document.getElementById('ltensolver-result-desc');

    resultBox.style.display = 'block';
    choiceEl.textContent = `Jawaban: ${result.huruf_jawaban} - ${result.teks_jawaban || ''}`;

    confEl.textContent = result.confidence || 'Tinggi';
    confEl.className = 'ltensolver-confidence-badge';

    if (result.modelUsed) {
      currentSettings.activeModel = result.modelUsed;
      const modelBadge = document.getElementById('ltensolver-widget-model');
      if (modelBadge) {
        modelBadge.textContent = result.modelUsed;
        modelBadge.title = `Model aktif: ${result.modelUsed}`;
      }
    }

    const modelLabel = result.modelUsed ? ` • ${result.modelUsed}` : '';
    descEl.textContent = `${result.alasan || 'Dianalisis oleh AI'}${modelLabel}`;
  }

  function playChimeSound(freq = 587.33) {
    if (!currentSettings.audioAlert) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } catch {
      // Audio tidak diizinkan
    }
  }

  async function convertImageToBase64(url) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 1200);
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        clearTimeout(timeout);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const dataURL = canvas.toDataURL('image/png');
          resolve({
            mimeType: 'image/png',
            data: dataURL.split(',')[1]
          });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => {
        clearTimeout(timeout);
        resolve(null);
      };
      img.src = url;
    });
  }

  function setupMutationObserver() {
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        isNavigating = false;
        retryCount = 0;

        if (checkMoodleErrorOrContinuePage()) {
          return;
        }

        checkContinuousAutoRun();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

})();
