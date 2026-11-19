/**
 * LTenOd - Content Script v1.4 (Fast & Bulletproof Engine)
 * Fitur:
 * 1. Pencegahan Double Submit (Fix error 'entered data outside normal sequence')
 * 2. Auto-Recovery untuk Halaman Error Moodle ('Continue' Button Auto-Click)
 * 3. Continuous Auto-Solve Tanpa Flapping Button
 * 4. Multi-provider + streaming progress + fallback model otomatis
 * 5. Widget draggable, minimize, stealth mode (Alt + H)
 * 6. Riwayat & statistik pengerjaan (dikirim ke popup)
 */

(function () {
  'use strict';

  if (window.__LTEN_OD_LOADED__) return;
  window.__LTEN_OD_LOADED__ = true;

  const adapter = getActiveAdapter();
  if (!adapter) {
    return;
  }

  const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

  let currentSettings = {
    solveMode: 'auto',
    minDelay: 1,
    maxDelay: 3,
    audioAlert: true,
    activeModel: DEFAULT_MODEL,
    provider: 'gemini'
  };

  let activeCountdownTimer = null;
  let isNavigating = false;
  let retryCount = 0;
  let lastHistoryId = null;

  // Muat setting awal
  chrome.storage.local.get(['solveMode', 'minDelay', 'maxDelay', 'audioAlert', 'activeModel', 'provider'], (res) => {
    if (res.solveMode) currentSettings.solveMode = res.solveMode;
    if (res.minDelay) currentSettings.minDelay = res.minDelay;
    if (res.maxDelay) currentSettings.maxDelay = res.maxDelay;
    if (typeof res.audioAlert === 'boolean') currentSettings.audioAlert = res.audioAlert;
    if (res.activeModel) currentSettings.activeModel = res.activeModel;
    if (res.provider) currentSettings.provider = res.provider;
    updateWidgetState();

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

  // Komunikasi dari popup & background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ ok: true, quizPage: !!document.querySelector(adapter.questionContainer) });
      return false;
    }

    if (msg.action === 'startSolve') {
      handlePrimaryButtonClick();
      sendResponse({ ok: true });
      return false;
    }

    const widget = document.getElementById('ltensolver-widget');
    if (!widget) return false;

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
      updateStatus('Konfigurasi aktif. Siap digunakan.', '#34d399');
    } else if (msg.action === 'llmProgress') {
      // Progres streaming dari background
      const suffix = msg.isFallback ? ' (model cadangan)' : '';
      updateStatus(`AI sedang menulis jawaban... ${msg.chars} karakter${suffix}`, '#60a5fa');
    } else if (msg.action === 'llmStatus') {
      updateStatus(msg.message || 'Memproses...', '#f59e0b');
    }
    return false;
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

  /* ---------------------------------------------------------------------- */
  /*  Helper status & countdown                                             */
  /* ---------------------------------------------------------------------- */

  function updateStatus(text, color) {
    const footerStatus = document.getElementById('ltensolver-footer-status');
    if (footerStatus) {
      footerStatus.textContent = text;
      footerStatus.style.color = color || '#94a3b8';
    }
  }

  /**
   * Countdown tunggal untuk semua aksi otomatis (Check / Next page).
   * getLabel(timeLeft) -> teks status; onFire() dipanggil saat hitung habis.
   */
  function startCountdown(getLabel, onFire) {
    const minD = Math.max(1, currentSettings.minDelay);
    const maxD = Math.max(minD, currentSettings.maxDelay);
    let timeLeft = Math.floor(Math.random() * (maxD - minD + 1) + minD);

    if (activeCountdownTimer) clearInterval(activeCountdownTimer);
    updateStatus(getLabel(timeLeft), '#34d399');

    activeCountdownTimer = setInterval(() => {
      timeLeft--;
      if (timeLeft > 0) {
        updateStatus(getLabel(timeLeft), '#34d399');
      } else {
        clearInterval(activeCountdownTimer);
        activeCountdownTimer = null;
        onFire();
      }
    }, 1000);
  }

  function clickMoodleButton(btn) {
    if (!btn) return;
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    btn.click();
  }

  /* ---------------------------------------------------------------------- */
  /*  Auto-recovery halaman error Moodle                                    */
  /* ---------------------------------------------------------------------- */

  function checkMoodleErrorOrContinuePage() {
    const continueBtn = document.querySelector('.continuebutton button, .continuebutton input[type="submit"], form[action*="attempt.php"] button[type="submit"]');
    const hasErrorMessage = document.querySelector('.errorbox, .errormessage, [data-rel="fatalerror"]');

    if (continueBtn && hasErrorMessage) {
      updateStatus('Memulihkan sesi kuis (Auto Continue)...', '#f59e0b');
      setTimeout(() => {
        continueBtn.click();
      }, 400);
      return true;
    }
    return false;
  }

  function checkContinuousAutoRun() {
    const isAutoActive = sessionStorage.getItem('ltensolver_auto_active') === 'true';
    if (isAutoActive && currentSettings.solveMode === 'auto') {
      updateWidgetButton(true);
      updateStatus('Membaca soal...', '#60a5fa');

      setTimeout(() => {
        if (sessionStorage.getItem('ltensolver_auto_active') === 'true') {
          triggerSolveProcess();
        }
      }, 350);
    } else {
      updateWidgetButton(false);
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  Floating widget                                                       */
  /* ---------------------------------------------------------------------- */

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
          <button class="ltensolver-win-btn" id="ltensolver-btn-min" title="Kecilkan / Perbesar" aria-label="Kecilkan widget">–</button>
          <button class="ltensolver-win-btn" id="ltensolver-btn-close" title="Sembunyikan (Alt+H)" aria-label="Sembunyikan widget">×</button>
        </div>
      </div>
      <div class="ltensolver-body" id="ltensolver-body">
        <div class="ltensolver-model-bar" id="ltensolver-model-bar" title="Model AI yang digunakan">
          <span class="ltensolver-model-prefix">Model</span>
          <span class="ltensolver-model-badge" id="ltensolver-widget-model">${DEFAULT_MODEL}</span>
        </div>

        <button class="ltensolver-btn-primary" id="ltensolver-btn-solve">
          <span id="ltensolver-btn-text">Pecahkan Soal (Alt+S)</span>
        </button>

        <div class="ltensolver-error-banner" id="ltensolver-error-banner" style="display: none;" role="alert"></div>

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
    updateStatus(message, '#94a3b8');
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
      modelBadge.textContent = currentSettings.activeModel || DEFAULT_MODEL;
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

  /* ---------------------------------------------------------------------- */
  /*  Deteksi kegagalan test case CodeRunner (dipakai 2 tempat)             */
  /* ---------------------------------------------------------------------- */

  function isTestFailed() {
    const testResults = document.querySelector('.coderunner-test-results');
    if (!testResults) return false;
    return testResults.classList.contains('bad') ||
      !!document.querySelector('.im-feedback .incorrect') ||
      !!testResults.querySelector('.text-danger, .fa-circle-xmark, [title*="Incorrect"]');
  }

  function reportOutcome(status) {
    if (!lastHistoryId) return;
    try {
      chrome.runtime.sendMessage({ action: 'reportOutcome', id: lastHistoryId, status }).catch(() => {});
    } catch { /* abaikan */ }
  }

  /* ---------------------------------------------------------------------- */
  /*  Mesin utama pemecah soal                                              */
  /* ---------------------------------------------------------------------- */

  async function triggerSolveProcess() {
    const btnSolve = document.getElementById('ltensolver-btn-solve');

    if (checkMoodleErrorOrContinuePage()) {
      return;
    }

    if (btnSolve.classList.contains('loading')) return;
    btnSolve.classList.add('loading');
    hideErrorDiagnostic();

    const finishBanner = document.getElementById('ltensolver-finish-guard-banner');
    if (finishBanner) finishBanner.style.display = 'none';

    const qContainer = document.querySelector(adapter.questionContainer);

    // 1. Soal saat ini sudah BENAR (correct) -> langsung lanjut
    if (qContainer) {
      const isCorrect = qContainer.classList.contains('correct') ||
        (qContainer.querySelector('.state')?.innerText || '').toLowerCase().includes('correct') ||
        (!!qContainer.querySelector('.fa-circle-check.text-success') && !qContainer.querySelector('.fa-circle-xmark.text-danger'));

      if (isCorrect) {
        clearEliminatedOptions(qContainer);
        sessionStorage.removeItem('ltensolver_code_retries');
        reportOutcome('correct');
        updateStatus('Jawaban BENAR (Correct)! Melanjutkan ke soal berikutnya...', '#34d399');
        playChimeSound(880);

        btnSolve.classList.remove('loading');
        if (currentSettings.solveMode === 'auto') {
          setTimeout(() => executeNextPageClick(), 1000);
        }
        return;
      }

      // 2. Tombol "Try again" aktif (jawaban salah, masih ada kesempatan)
      const tryAgainBtn = document.querySelector(adapter.tryAgainButton || 'input[name$="-tryagain"], input[value="Try again"], button.tryagain');
      if (tryAgainBtn) {
        recordWrongOptionFromDom(qContainer);
        reportOutcome('wrong');

        updateStatus('Jawaban salah. Menekan Try again untuk mencoba pilihan lain...', '#f59e0b');
        playChimeSound(440);

        btnSolve.classList.remove('loading');
        setTimeout(() => clickMoodleButton(tryAgainBtn), 800);
        return;
      }

      // 3. Soal final incorrect (kesempatan habis) -> lanjut
      const isFinalIncorrect = (
        qContainer.classList.contains('incorrect') ||
        (qContainer.querySelector('.state')?.innerText || '').toLowerCase().includes('incorrect')
      ) && !tryAgainBtn && !document.querySelector('.coderunner-test-results');

      if (isFinalIncorrect) {
        clearEliminatedOptions(qContainer);
        reportOutcome('wrong');
        updateStatus('Kesempatan menjawab telah habis. Melanjutkan ke soal berikutnya...', '#f87171');

        btnSolve.classList.remove('loading');
        if (currentSettings.solveMode === 'auto') {
          setTimeout(() => executeNextPageClick(), 1500);
        }
        return;
      }
    }

    // 4. Hasil evaluasi CodeRunner
    const testResults = document.querySelector('.coderunner-test-results');
    const isCodeRunnerQuestion = !!document.querySelector('.que.coderunner, textarea.coderunner-answer, .ui_wrapper .ace_editor');

    if (isCodeRunnerQuestion && testResults && isTestFailed()) {
      // Klik "Show differences" agar Expected vs Got terlihat
      const diffBtn = document.querySelector(adapter.codeDiffBtn || 'input[name$="-diffbutton"], button[name$="-diffbutton"], input[value*="differences"]');
      if (diffBtn && (diffBtn.value || '').toLowerCase().includes('show differences')) {
        try { clickMoodleButton(diffBtn); } catch { /* abaikan */ }
      }

      let codeRetries = parseInt(sessionStorage.getItem('ltensolver_code_retries') || '0', 10);
      if (codeRetries >= 5) {
        sessionStorage.removeItem('ltensolver_code_retries');
        reportOutcome('wrong');
        stopAutoLoop('Telah mencoba 5x perbaikan otomatis. Periksa rincian Expected vs Got di halaman.');
        btnSolve.classList.remove('loading');
        return;
      }
      codeRetries++;
      sessionStorage.setItem('ltensolver_code_retries', String(codeRetries));
      updateStatus(`Menganalisa perbedaan (Show diff) & memperbaiki kode (${codeRetries}/5)...`, '#f59e0b');
    } else if (isCodeRunnerQuestion && testResults && !isTestFailed()) {
      // Semua test case lolos
      sessionStorage.removeItem('ltensolver_code_retries');
      reportOutcome('correct');
      updateStatus('Semua test case lolos 100%! Melanjutkan ke soal berikutnya...', '#34d399');
      playChimeSound(880);

      btnSolve.classList.remove('loading');
      if (currentSettings.solveMode === 'auto') {
        setTimeout(() => executeNextPageClick(), 1000);
      }
      return;
    }

    updateStatus('Membaca soal...', '#94a3b8');

    try {
      const questionData = await extractQuestionData();
      if (!questionData) {
        // Halaman summary attempt Moodle?
        if (document.querySelector('.quizsummaryofattempt, .summarycomputertable, form[action*="processattempt"] input[value*="Submit all"]')) {
          stopAutoLoop('Semua soal telah selesai dikerjakan.');
          if (finishBanner) {
            finishBanner.style.display = 'block';
            finishBanner.textContent = 'Ringkasan Kuis Moodle: semua soal telah terjawab. Periksa kembali status jawaban lalu klik "Submit all and finish" secara manual.';
          }
          btnSolve.classList.remove('loading');
          updateStatus('Kuis selesai. Silakan kumpulkan.', '#34d399');
          return;
        }

        // DOM belum siap: coba lagi maksimal 3x
        if (retryCount < 3) {
          retryCount++;
          btnSolve.classList.remove('loading');
          updateStatus(`Menunggu soal (${retryCount}/3)...`, '#94a3b8');
          setTimeout(() => triggerSolveProcess(), 500);
          return;
        }
        throw new Error('Tidak menemukan kontainer soal aktif pada halaman ini.');
      }

      retryCount = 0;
      const isFixingCode = questionData.failedTests && questionData.failedTests.length > 0;
      if (questionData.type === 'coderunner') {
        updateStatus(isFixingCode ? 'Memperbaiki kode via AI (menganalisis Expected vs Got)...' : 'Menyusun solusi koding via AI...', '#60a5fa');
      } else if (questionData.type === 'matching') {
        updateStatus(`Mencocokkan ${questionData.items.length} pasangan jawaban via AI...`, '#60a5fa');
      } else {
        updateStatus('Menganalisis jawaban via AI...', '#60a5fa');
      }

      // Kirim payload bersih tanpa referensi DOM ke background
      const payload = buildPayloadForAI(questionData);

      chrome.runtime.sendMessage(
        { action: 'solveQuestion', data: payload },
        (response) => {
          btnSolve.classList.remove('loading');

          if (!response || !response.success) {
            const rawErr = response ? response.error : 'Koneksi gagal atau tidak ada respons.';
            showErrorDiagnostic(rawErr, response && response.errorCode, response && response.errorAdvice);
            stopAutoLoop('Gagal memproses soal.');
            return;
          }

          hideErrorDiagnostic();
          const res = response.result;
          if (res.historyId) lastHistoryId = res.historyId;
          displayResult(res);
          updateStatusFromMeta(res);
          applyAnswer(questionData, res);
        }
      );

    } catch (err) {
      btnSolve.classList.remove('loading');
      showErrorDiagnostic(err.message);
      stopAutoLoop('Terjadi kesalahan.');
    }
  }

  function updateStatusFromMeta(res) {
    if (res && res.meta && res.meta.fallbackUsed) {
      updateStatus(`Model utama gagal; memakai cadangan: ${res.modelUsed}`, '#f59e0b');
    } else if (res && res.meta && typeof res.meta.latencyMs === 'number') {
      updateStatus(`Selesai dalam ${(res.meta.latencyMs / 1000).toFixed(1)}s via ${res.modelUsed}`, '#34d399');
    }
  }

  /**
   * Kartu diagnosa kesalahan. v1.4: memakai error code terstruktur dari background
   * + teks disisipkan lewat textContent (bukan innerHTML) agar aman.
   */
  function showErrorDiagnostic(rawErr, errorCode, errorAdvice) {
    const errorBox = document.getElementById('ltensolver-error-banner');
    const resultBox = document.getElementById('ltensolver-result-box');

    if (resultBox) resultBox.style.display = 'none';

    const s = String(errorCode || rawErr || '').toLowerCase();
    let title = 'Gagal Memproses Soal';
    let desc = rawErr || 'Terjadi kesalahan tidak diketahui.';
    let advice = errorAdvice || 'Periksa konfigurasi di popup ekstensi.';

    if (s.includes('rate_limit') || s.includes('429') || s.includes('quota')) {
      title = 'Kuota / Token Habis (HTTP 429)';
      desc = 'Batas kuota token atau rate limit akun provider telah tercapai.';
      if (!errorAdvice) advice = 'Solusi: cek saldo token, atau aktifkan model cadangan di popup.';
    } else if (s.includes('auth') || s.includes('401') || s.includes('403')) {
      title = 'API Key Tidak Valid (HTTP 401/403)';
      desc = 'Kredensial API Key ditolak oleh provider AI.';
      if (!errorAdvice) advice = 'Solusi: periksa API Key di popup (tanpa spasi di awal/akhir).';
    } else if (s.includes('model_not_found') || s.includes('404')) {
      title = 'Model Tidak Ditemukan (HTTP 404)';
      desc = 'Model yang dipilih tidak tersedia pada provider ini.';
      if (!errorAdvice) advice = 'Solusi: klik "Deteksi & Periksa Model" lalu pilih model yang aktif.';
    } else if (s.includes('timeout')) {
      title = 'Koneksi Timeout';
      desc = 'Server AI atau koneksi internet terlalu lambat merespons.';
      if (!errorAdvice) advice = 'Solusi: gunakan model yang lebih ringan (mis. flash-lite).';
    } else if (s.includes('server') || s.includes('500') || s.includes('502') || s.includes('503')) {
      title = 'Server Provider Gangguan';
      desc = String(rawErr || 'Server API sedang bermasalah.');
      if (!errorAdvice) advice = 'Solusi: tunggu sesaat atau gunakan model/provider cadangan.';
    } else if (s.includes('no_key')) {
      title = 'API Key Belum Diisi';
      desc = 'Ekstensi belum dikonfigurasi dengan API Key.';
      if (!errorAdvice) advice = 'Solusi: buka popup LTenOd, pilih provider, masukkan API Key.';
    } else if (s.includes('bad_response')) {
      title = 'Respons AI Tidak Valid';
      desc = String(rawErr || 'Model mengirim format yang tidak bisa dibaca.');
      if (!errorAdvice) advice = 'Solusi: coba model lain yang lebih stabil untuk JSON.';
    }

    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.replaceChildren();

      const titleEl = document.createElement('div');
      titleEl.className = 'ltensolver-error-title';
      titleEl.textContent = title;

      const descEl = document.createElement('div');
      descEl.className = 'ltensolver-error-desc';
      descEl.textContent = desc;

      const adviceEl = document.createElement('div');
      adviceEl.className = 'ltensolver-error-advice';
      adviceEl.textContent = advice;

      errorBox.append(titleEl, descEl, adviceEl);
    }

    updateStatus(title, '#f87171');
  }

  function hideErrorDiagnostic() {
    const errorBox = document.getElementById('ltensolver-error-banner');
    if (errorBox) {
      errorBox.style.display = 'none';
      errorBox.replaceChildren();
    }
  }

  function checkAutoSubmitGuard() {
    stopAutoLoop('Semua soal telah selesai.');
    playChimeSound(660);

    const finishBanner = document.getElementById('ltensolver-finish-guard-banner');
    if (finishBanner) {
      finishBanner.style.display = 'block';
      finishBanner.textContent = 'Semua Soal Telah Selesai Dijawab! Periksa kembali jawaban Anda, lalu kumpulkan kuis secara manual.';
    }

    updateStatus('Kuis selesai. Silakan periksa & kumpulkan.', '#34d399');
    return true;
  }

  /* ---------------------------------------------------------------------- */
  /*  Ekstraksi soal dari DOM                                               */
  /* ---------------------------------------------------------------------- */

  async function extractQuestionData() {
    const qContainer = document.querySelector(adapter.questionContainer);
    if (!qContainer) return null;

    // 1. CodeRunner (koding)
    const isCodeRunner = qContainer.classList.contains('coderunner') ||
      !!qContainer.querySelector('textarea.coderunner-answer, textarea.edit_code, .ui_wrapper .ace_editor, table.coderunnerexamples');
    if (isCodeRunner) {
      return await extractCodeRunnerData(qContainer);
    }

    // 2. Matching (dropdown per baris)
    const isMatching = qContainer.classList.contains('match') ||
      !!qContainer.querySelector('table.answer select, td.control select, .ablock table select');
    if (isMatching) {
      return await extractMatchingData(qContainer);
    }

    // 3. Pilihan ganda
    return await extractMultiChoiceData(qContainer);
  }

  async function extractMatchingData(qContainer) {
    const qTextEl = qContainer.querySelector(adapter.questionText || '.qtext');
    const questionText = qTextEl ? qTextEl.innerText.trim() : '';

    const images = await collectImages(qContainer);

    const rows = qContainer.querySelectorAll('table.answer tr, .ablock table tr, tr.r0, tr.r1');
    const items = [];

    rows.forEach((row) => {
      const selectEl = row.querySelector('select');
      if (!selectEl) return;

      const textEl = row.querySelector('td.text, th.text, .itemtext, td:first-child');
      let itemText = textEl ? textEl.innerText.trim() : '';
      if (!itemText) {
        const clone = row.cloneNode(true);
        clone.querySelectorAll('select, label, .visually-hidden, button').forEach(el => el.remove());
        itemText = clone.innerText.trim();
      }

      const options = [];
      Array.from(selectEl.options).forEach((opt) => {
        const val = opt.value;
        const txt = opt.text.trim();
        if (val === '0' || val === '' || txt.toLowerCase().startsWith('choose') || txt.toLowerCase().startsWith('pilih')) {
          return;
        }
        options.push({ value: val, text: txt });
      });

      if (itemText && options.length > 0) {
        items.push({
          index: items.length,
          subName: selectEl.name || selectEl.id,
          id: selectEl.id,
          itemText: itemText,
          selectElement: selectEl,
          options: options
        });
      }
    });

    return {
      type: 'matching',
      container: qContainer,
      questionText: questionText,
      items: items,
      images: images
    };
  }

  async function extractCodeRunnerData(qContainer) {
    const qTextEl = qContainer.querySelector(adapter.questionText || '.qtext');
    let questionText = qTextEl ? qTextEl.innerText.trim() : '';

    // Contoh test case bawaan
    const exampleTable = qContainer.querySelector(adapter.codeExamples || 'table.coderunnerexamples, .coderunner-examples');
    if (exampleTable) {
      const rows = exampleTable.querySelectorAll('tbody tr');
      if (rows.length > 0) {
        let examplesText = '\n\nCONTOH TEST CASE DARI SOAL:';
        rows.forEach((r, idx) => {
          const cells = r.querySelectorAll('td');
          if (cells.length >= 2) {
            examplesText += `\nTest ${idx + 1}:\nInput:\n${cleanCellText(cells[0])}\nExpected Result:\n${cleanCellText(cells[1])}\n---`;
          }
        });
        questionText += examplesText;
      }
    }

    // Starter code dari data-reload-text tombol reset
    const textarea = qContainer.querySelector(adapter.codeEditor || 'textarea.coderunner-answer, textarea.edit_code, textarea[name$="_answer"]');
    const resetBtn = qContainer.querySelector(adapter.codeResetBtn || 'input.answer_reset_btn');

    let starterCode = '';
    if (resetBtn && resetBtn.getAttribute('data-reload-text')) {
      starterCode = resetBtn.getAttribute('data-reload-text').trim();
    }

    let currentCode = '';
    if (textarea && textarea.value && textarea.value.trim().length > 0) {
      currentCode = textarea.value.trim();
    }
    if (!starterCode) {
      starterCode = currentCode;
    }

    // Test case yang gagal (Expected vs Got)
    const testResultsTable = document.querySelector('table.coderunner-test-results, .coderunner-test-results table');
    const failedTests = [];

    if (testResultsTable) {
      const rows = testResultsTable.querySelectorAll('tbody tr');
      rows.forEach((r, idx) => {
        const isFail = !!r.querySelector('.text-danger, .fa-circle-xmark, [title*="Incorrect"]');
        if (isFail) {
          const inEl = r.querySelector('.c1 pre') || r.querySelector('.c1');
          const expEl = r.querySelector('.c2 pre') || r.querySelector('.c2');
          const gotEl = r.querySelector('.c3 pre') || r.querySelector('.c3');

          failedTests.push({
            testIndex: idx + 1,
            input: cleanCellText(inEl),
            expected: cleanCellText(expEl),
            got: cleanCellText(gotEl)
          });
        }
      });
    }

    const lang = (textarea ? textarea.getAttribute('data-lang') : '') || 'Python3';
    const textareaId = textarea ? textarea.id : '';
    const images = await collectImages(qContainer);

    return {
      type: 'coderunner',
      container: qContainer,
      questionText,
      starterCode,
      currentCode: currentCode || starterCode,
      failedTests,
      lang,
      textareaId,
      images
    };
  }

  async function extractMultiChoiceData(qContainer) {
    const qTextEl = qContainer.querySelector(adapter.questionText);
    const questionText = qTextEl ? qTextEl.innerText.trim() : '';

    const images = await collectImages(qContainer);

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

    const eliminatedOptions = getEliminatedOptions(qContainer);

    return {
      type: 'multichoice',
      container: qContainer,
      questionText,
      options,
      eliminatedOptions,
      images
    };
  }

  function cleanCellText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, .xy-copy-button, .visually-hidden, .fa, .icon').forEach(n => n.remove());
    return clone.innerText.trim();
  }

  /* ---------------------------------------------------------------------- */
  /*  Memori eliminasi opsi salah (key = hash teks soal, anti tabrakan)     */
  /* ---------------------------------------------------------------------- */

  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }

  function getQuestionKey(qContainer) {
    const attempt = document.querySelector('input[name="attempt"]')?.value || '';
    const qTextEl = qContainer ? qContainer.querySelector(adapter.questionText || '.qtext') : null;
    const qHash = hashString(qTextEl ? qTextEl.innerText.trim().slice(0, 400) : (qContainer ? qContainer.id : 'default'));
    return `${qHash}_${attempt}`;
  }

  function recordWrongOptionFromDom(qContainer) {
    try {
      const checkedInput = qContainer.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked');
      if (!checkedInput) return;

      const parentItem = checkedInput.closest(adapter.optionItems || '.r0, .r1, .answer > div');
      const label = parentItem ? (parentItem.querySelector(adapter.optionLabel) || parentItem) : null;
      let text = label ? label.innerText.trim() : checkedInput.value;
      text = text.replace(/^[a-eA-E][.)\s-]+/, '').trim();

      const key = 'ltensolver_eliminated_' + getQuestionKey(qContainer);
      const existing = JSON.parse(sessionStorage.getItem(key) || '[]');
      if (text && !existing.includes(text)) {
        existing.push(text);
        sessionStorage.setItem(key, JSON.stringify(existing));
      }
    } catch (e) {
      console.warn('[LTenOd] Gagal menyimpan opsi tereliminasi:', e);
    }
  }

  function getEliminatedOptions(qContainer) {
    try {
      const key = 'ltensolver_eliminated_' + getQuestionKey(qContainer);
      return JSON.parse(sessionStorage.getItem(key) || '[]');
    } catch {
      return [];
    }
  }

  function clearEliminatedOptions(qContainer) {
    try {
      const key = 'ltensolver_eliminated_' + getQuestionKey(qContainer);
      sessionStorage.removeItem(key);
    } catch { /* abaikan */ }
  }

  /* ---------------------------------------------------------------------- */
  /*  Payload bersih untuk background (tanpa referensi DOM)                 */
  /* ---------------------------------------------------------------------- */

  function buildPayloadForAI(questionData) {
    const base = {
      type: questionData.type,
      questionText: questionData.questionText,
      images: questionData.images || []
    };

    if (questionData.type === 'coderunner') {
      return {
        ...base,
        starterCode: questionData.starterCode,
        currentCode: questionData.currentCode,
        failedTests: questionData.failedTests,
        lang: questionData.lang
      };
    }

    if (questionData.type === 'matching') {
      return {
        ...base,
        items: (questionData.items || []).map(it => ({
          index: it.index,
          itemText: it.itemText,
          options: it.options
        }))
      };
    }

    return {
      ...base,
      options: (questionData.options || []).map(opt => ({
        index: opt.index,
        letter: opt.letter,
        text: opt.text
      })),
      eliminatedOptions: questionData.eliminatedOptions
    };
  }

  /* ---------------------------------------------------------------------- */
  /*  Gambar: ambil via background (bebas CORS) + downscale hemat token    */
  /* ---------------------------------------------------------------------- */

  const MAX_IMAGE_DIM = 1024;

  async function collectImages(qContainer) {
    const imgElements = qContainer.querySelectorAll(adapter.questionImages || '.qtext img');
    const images = [];
    for (const img of imgElements) {
      if (img.src && !img.src.includes('theme/image.php') && !img.src.includes('pix.php')) {
        try {
          const result = await fetchImageBase64(img.src);
          if (result) images.push(result);
        } catch { // gambar gagal diproses: lanjut tanpa gambar ini
        }
      }
    }
    return images;
  }

  async function fetchImageBase64(url) {
    // Jalur 1: minta background mengambil gambar (bebas masalah CORS)
    const viaBackground = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'fetchImage', url }, (res) => {
          if (chrome.runtime.lastError || !res || !res.success) resolve(null);
          else resolve(res);
        });
      } catch {
        resolve(null);
      }
    });

    let candidate = null;
    if (viaBackground && viaBackground.data) {
      candidate = { mimeType: viaBackground.mimeType, data: viaBackground.data };
    } else {
      // Jalur 2: fallback canvas langsung di halaman
      candidate = await convertImageToBase64(url);
    }

    if (!candidate) return null;
    return downscaleImage(candidate);
  }

  /** Turunkan resolusi gambar agar hemat token & latency (maks 1024px sisi terpanjang). */
  function downscaleImage(candidate) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        const dataUrl = `data:${candidate.mimeType};base64,${candidate.data}`;
        img.onload = () => {
          try {
            const maxDim = Math.max(img.width, img.height);
            if (maxDim <= MAX_IMAGE_DIM) {
              resolve(candidate); // sudah kecil, kirim apa adanya
              return;
            }
            const scale = MAX_IMAGE_DIM / maxDim;
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const resized = canvas.toDataURL('image/jpeg', 0.85);
            resolve({ mimeType: 'image/jpeg', data: resized.split(',')[1] });
          } catch {
            resolve(candidate);
          }
        };
        img.onerror = () => resolve(candidate);
        img.src = dataUrl;
      } catch {
        resolve(candidate);
      }
    });
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

  /* ---------------------------------------------------------------------- */
  /*  Penerapan jawaban ke halaman                                          */
  /* ---------------------------------------------------------------------- */

  async function applyAnswer(questionData, result) {
    if (questionData.type === 'coderunner' || result.type === 'coderunner') {
      await applyCodeRunnerAnswer(questionData, result);
      return;
    }

    if (questionData.type === 'matching' || result.type === 'matching') {
      await applyMatchingAnswer(questionData, result);
      return;
    }

    const targetIndex = result.index_jawaban;
    const targetOption = questionData.options[targetIndex] || questionData.options.find(
      opt => opt.letter.toUpperCase() === String(result.huruf_jawaban).toUpperCase()
    );

    if (!targetOption) {
      updateStatus(`Opsi ${result.huruf_jawaban} tidak ditemukan.`, '#f87171');
      stopAutoLoop();
      return;
    }

    clearHighlights();

    const el = targetOption.element;
    el.classList.add('ltensolver-highlighted-choice');
    const badge = document.createElement('span');
    badge.className = 'ltensolver-choice-badge';
    badge.textContent = `Pilihan: ${result.huruf_jawaban}`;
    el.appendChild(badge);

    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    selectOptionReliably(targetOption);

    const checkBtn = document.querySelector(adapter.checkButton || 'input[name$="-submit"], button[name$="-submit"], input[id$="-submit"], button[id$="-submit"], input[value="Check"]');

    if (currentSettings.solveMode === 'auto') {
      if (checkBtn) {
        startCountdown(
          (t) => `Jawaban ${result.huruf_jawaban} dipilih. Menjalankan Check dalam ${t}s...`,
          () => {
            updateStatus('Menjalankan Check...', '#34d399');
            clickMoodleButton(checkBtn);
          }
        );
      } else {
        const nextBtn = findStrictNextButton();
        const isFinishStep = !nextBtn || (
          (nextBtn.value || '').toLowerCase().includes('finish') ||
          (nextBtn.value || '').toLowerCase().includes('selesai')
        );

        if (isFinishStep) {
          showFinishGuard(`Jawaban soal terakhir (${result.huruf_jawaban}) telah dipilih dan dicentang. Ekstensi menahan auto-submit agar Anda dapat memeriksa jawaban. Klik "Finish attempt" di bawah untuk mengumpulkan kuis.`);
          return;
        }

        startCountdown(
          (t) => `Lanjut otomatis dalam ${t}s...`,
          () => executeNextPageClick()
        );
      }
    } else {
      if (checkBtn) {
        updateStatus(`Opsi ${result.huruf_jawaban} dipilih. Silakan klik Check.`, '#34d399');
      } else {
        updateStatus(`Opsi ${result.huruf_jawaban} ditandai (Highlight Mode)`, '#34d399');
      }
    }
  }

  async function applyMatchingAnswer(questionData, result) {
    const matches = result.matches || [];

    if (matches.length === 0) {
      updateStatus('Gagal mendapatkan pasangan jawaban dari AI.', '#f87171');
      stopAutoLoop('Gagal mencocokkan jawaban.');
      return;
    }

    clearHighlights();

    let selectedCount = 0;

    for (const match of matches) {
      let itemData = null;

      // Prioritaskan pencocokan berdasarkan itemText (presisi, hindari off-by-one)
      if (match.itemText) {
        const matchText = match.itemText.trim().toLowerCase();
        itemData = questionData.items.find(it => {
          const itText = it.itemText.trim().toLowerCase();
          return itText === matchText || itText.includes(matchText) || matchText.includes(itText);
        });
      }

      // Fallback ke index (dukung 0-based maupun 1-based)
      if (!itemData && match.index !== undefined && match.index !== null) {
        const rawIdx = parseInt(match.index, 10);
        if (questionData.items[rawIdx]) {
          itemData = questionData.items[rawIdx];
        } else if (questionData.items[rawIdx - 1]) {
          itemData = questionData.items[rawIdx - 1];
        }
      }

      if (!itemData) continue;

      const selectEl = itemData.selectElement ||
        document.querySelector(`select[name="${itemData.subName}"]`) ||
        (itemData.id ? document.getElementById(itemData.id) : null);
      if (!selectEl) continue;

      let targetOption = null;
      if (match.chosenValue !== undefined && match.chosenValue !== null) {
        targetOption = Array.from(selectEl.options).find(opt => String(opt.value) === String(match.chosenValue));
      }

      if (!targetOption && match.chosenText) {
        const cleanChosen = match.chosenText.trim().toLowerCase();
        targetOption = Array.from(selectEl.options).find(opt => {
          const optText = opt.text.trim().toLowerCase();
          return optText === cleanChosen || optText.includes(cleanChosen) || cleanChosen.includes(optText);
        });
      }

      if (targetOption) {
        selectEl.value = targetOption.value;
        selectEl.dispatchEvent(new Event('focus', { bubbles: true }));
        selectEl.dispatchEvent(new Event('input', { bubbles: true }));
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        selectEl.dispatchEvent(new Event('blur', { bubbles: true }));

        const tr = selectEl.closest('tr') || selectEl.parentElement;
        if (tr) {
          tr.classList.add('ltensolver-highlighted-choice');
          const badge = document.createElement('span');
          badge.className = 'ltensolver-choice-badge';
          badge.textContent = `OK: ${targetOption.text.split('.')[0] || targetOption.text.slice(0, 15)}`;
          tr.appendChild(badge);
        }
        selectedCount++;
      }
    }

    playChimeSound(660);

    const checkBtn = document.querySelector(adapter.checkButton || 'input[name$="-submit"], button[name$="-submit"], input[id$="-submit"], button[id$="-submit"], input[value="Check"]');

    if (currentSettings.solveMode === 'auto') {
      if (checkBtn) {
        startCountdown(
          (t) => `${selectedCount}/${questionData.items.length} pasangan dicocokkan. Menjalankan Check dalam ${t}s...`,
          () => {
            updateStatus('Menjalankan Check...', '#34d399');
            clickMoodleButton(checkBtn);
          }
        );
      } else {
        const nextBtn = findStrictNextButton();
        const isFinishStep = !nextBtn || (
          (nextBtn.value || '').toLowerCase().includes('finish') ||
          (nextBtn.value || '').toLowerCase().includes('selesai')
        );

        if (isFinishStep) {
          showFinishGuard(`Seluruh ${selectedCount} pasangan jawaban pada soal terakhir telah dipilih otomatis. Ekstensi menahan tombol "Finish attempt" agar Anda dapat meninjau jawaban sebelum mengumpulkan kuis.`);
          return;
        }

        startCountdown(
          (t) => `${selectedCount}/${questionData.items.length} pasangan dicocokkan. Lanjut otomatis dalam ${t}s...`,
          () => executeNextPageClick()
        );
      }
    } else {
      updateStatus(`${selectedCount}/${questionData.items.length} pasangan dicocokkan (Highlight Mode)`, '#34d399');
    }
  }

  async function applyCodeRunnerAnswer(questionData, result) {
    const solutionCode = result.code || '';

    if (!solutionCode) {
      updateStatus('Kode jawaban kosong dari AI.', '#f87171');
      stopAutoLoop('Gagal mendapatkan kode solusi koding.');
      return;
    }

    const hasFailedTests = questionData.failedTests && questionData.failedTests.length > 0;
    const shouldReset = hasFailedTests || result.isFix;

    updateStatus(
      shouldReset ? 'Mereset kodingan lama & memasukkan kode solusi perbaikan AI...' : 'Memasukkan kode solusi AI ke dalam editor...',
      '#60a5fa'
    );

    injectCodeToCodeRunner(questionData.textareaId, solutionCode, shouldReset);

    const editorWrapper = document.querySelector('.ui_wrapper') || document.getElementById(questionData.textareaId);
    if (editorWrapper) {
      editorWrapper.classList.add('ltensolver-code-active');
      editorWrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    playChimeSound(660);

    const checkBtn = document.querySelector(adapter.checkButton || 'button.submit[name$="-submit"], input.submit[name$="-submit"], button[id$="-submit"]');

    if (currentSettings.solveMode === 'auto') {
      if (checkBtn) {
        startCountdown(
          (t) => `Kode terisi. Menjalankan Check dalam ${t}s...`,
          () => {
            updateStatus('Menjalankan Check...', '#34d399');
            clickMoodleButton(checkBtn);
          }
        );
      } else {
        const nextBtn = findStrictNextButton();
        if (nextBtn) {
          executeNextPageClick();
        } else {
          checkAutoSubmitGuard();
        }
      }
    } else {
      updateStatus('Kode berhasil diisi. Silakan periksa lalu klik Check.', '#34d399');
    }
  }

  function clearHighlights() {
    document.querySelectorAll('.ltensolver-highlighted-choice').forEach(el => {
      el.classList.remove('ltensolver-highlighted-choice');
      const badge = el.querySelector('.ltensolver-choice-badge');
      if (badge) badge.remove();
    });
  }

  function showFinishGuard(message) {
    stopAutoLoop('Semua soal telah selesai dijawab.');
    playChimeSound(660);

    const finishBanner = document.getElementById('ltensolver-finish-guard-banner');
    if (finishBanner) {
      finishBanner.style.display = 'block';
      finishBanner.textContent = `Semua Soal Telah Selesai Dijawab! ${message}`;
    }

    updateStatus('Kuis selesai. Silakan periksa & kumpulkan.', '#34d399');
  }

  /* ---------------------------------------------------------------------- */
  /*  Injeksi kode ke CodeRunner (textarea + Ace editor)                    */
  /* ---------------------------------------------------------------------- */

  function injectCodeToCodeRunner(textareaId, code, shouldReset = false) {
    // 1. Set textarea langsung di konteks content script
    const ta = (textareaId ? document.getElementById(textareaId) : null) ||
      document.querySelector('textarea.coderunner-answer, textarea.edit_code, textarea[name$="_answer"]');
    if (ta) {
      ta.value = code;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 2. Set Ace Editor di konteks halaman (window.ace) & tangani Reset answer
    try {
      const script = document.createElement('script');
      script.textContent = `
        (function() {
          try {
            const tid = ${JSON.stringify(textareaId)};
            const codeStr = ${JSON.stringify(code)};
            const shouldReset = ${Boolean(shouldReset)};

            function applyCode() {
              const textarea = (tid ? document.getElementById(tid) : null) ||
                document.querySelector('textarea.coderunner-answer, textarea.edit_code, textarea[name$="_answer"]');

              if (textarea) {
                textarea.value = codeStr;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.dispatchEvent(new Event('change', { bubbles: true }));
              }

              let aceContainer = null;
              if (textarea && textarea.parentElement) {
                aceContainer = textarea.parentElement.querySelector('.ace_editor');
              }
              if (!aceContainer) {
                aceContainer = document.querySelector('.ui_wrapper .ace_editor, .ace_editor');
              }

              if (aceContainer && window.ace) {
                const editor = window.ace.edit(aceContainer);
                if (editor) {
                  editor.setValue(codeStr, -1);
                  editor.clearSelection();
                  if (editor.getSession() && editor.getSession().getUndoManager()) {
                    editor.getSession().getUndoManager().markClean();
                  }
                }
              }
            }

            if (shouldReset) {
              const resetBtn = document.querySelector('input.answer_reset_btn, input[name$="-resetbutton"], button[name$="-resetbutton"], input[value="Reset answer"]');
              if (resetBtn) {
                const origConfirm = window.confirm;
                try {
                  window.confirm = () => true;
                  resetBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                  resetBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                  resetBtn.click();
                } catch(re) {
                  console.warn('[LTenOd] Reset button click error:', re);
                } finally {
                  window.confirm = origConfirm;
                }
              }
            }

            applyCode();
            setTimeout(applyCode, 60);
          } catch(e) {
            console.error('[LTenOd] Gagal sinkronisasi Ace Editor / Reset:', e);
          }
        })();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (err) {
      console.warn('[LTenOd] Script injection error:', err);
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  Anti double-submit: satu klik submit + kunci navigasi                 */
  /* ---------------------------------------------------------------------- */

  function executeNextPageClick() {
    if (isNavigating) return;

    // GUARD KODING: jangan lanjut jika test case masih gagal
    const isCodeRunner = !!document.querySelector('.que.coderunner, textarea.coderunner-answer, .ui_wrapper .ace_editor');
    if (isCodeRunner && document.querySelector('.coderunner-test-results') && isTestFailed()) {
      console.warn('[LTenOd] Menahan Next Page: Soal koding belum lulus semua test case.');
      return;
    }

    // GUARD INTERACTIVE: jangan lanjut jika tombol "Try again" aktif
    const tryAgainBtn = document.querySelector(adapter.tryAgainButton || 'input[name$="-tryagain"], input[value="Try again"], button.tryagain');
    if (tryAgainBtn) {
      console.warn('[LTenOd] Menahan Next Page: Masih ada kesempatan mencoba ulang (Try again).');
      return;
    }

    const nextBtn = findStrictNextButton();

    if (nextBtn) {
      isNavigating = true;
      updateStatus('Membuka soal berikutnya...', '#94a3b8');

      nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      clickMoodleButton(nextBtn);

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

    // Tolak tombol tryagain
    if (name.includes('tryagain') || id.includes('tryagain') || className.includes('tryagain') || value.includes('try again') || value.includes('coba lagi')) {
      return false;
    }

    // Tolak tombol reset answer & show differences
    if (name.includes('resetbutton') || id.includes('resetbutton') || className.includes('resetbutton') || className.includes('answer_reset_btn') || value.includes('reset answer') ||
        name.includes('diffbutton') || id.includes('diffbutton') || className.includes('diffbutton') || value.includes('differences')) {
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

  /* ---------------------------------------------------------------------- */
  /*  Tampilan hasil pada widget                                            */
  /* ---------------------------------------------------------------------- */

  function displayResult(result) {
    const resultBox = document.getElementById('ltensolver-result-box');
    const choiceEl = document.getElementById('ltensolver-result-choice');
    const confEl = document.getElementById('ltensolver-result-conf');
    const descEl = document.getElementById('ltensolver-result-desc');

    if (!resultBox) return;
    resultBox.style.display = 'block';

    if (result.modelUsed) {
      currentSettings.activeModel = result.modelUsed;
      const modelBadge = document.getElementById('ltensolver-widget-model');
      if (modelBadge) {
        modelBadge.textContent = result.modelUsed;
        modelBadge.title = `Model aktif: ${result.modelUsed}`;
      }
    }

    const modelLabel = result.modelUsed ? ` | ${result.modelUsed}` : '';

    if (result.type === 'coderunner') {
      choiceEl.textContent = result.isFix ? 'Perbaikan Koding Selesai' : 'Solusi Koding Siap';
      confEl.textContent = result.isFix ? 'Refined' : 'Koding';
      confEl.className = 'ltensolver-confidence-badge';
      descEl.textContent = `${result.explanation || (result.isFix ? 'Kode berhasil diperbaiki berdasarkan output test case.' : 'Kode program berhasil diisikan ke editor CodeRunner.')}${modelLabel}`;
      return;
    }

    if (result.type === 'matching') {
      const matchCount = (result.matches && result.matches.length) || 0;
      choiceEl.textContent = `${matchCount} Pasangan Cocok`;
      confEl.textContent = 'Matching';
      confEl.className = 'ltensolver-confidence-badge';
      descEl.textContent = `Seluruh ${matchCount} pasangan dropdown berhasil dicocokkan otomatis oleh AI${modelLabel}.`;
      return;
    }

    choiceEl.textContent = `Jawaban: ${result.huruf_jawaban} - ${result.teks_jawaban || ''}`;
    confEl.textContent = result.confidence || 'Tinggi';
    confEl.className = 'ltensolver-confidence-badge';
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

  /* ---------------------------------------------------------------------- */
  /*  Hook pengujian (Playwright via file:// mock pages)                    */
  /* ---------------------------------------------------------------------- */

  window.__LTEN_OD_TEST__ = {
    version: '1.4.0',
    extractQuestionData,
    buildPayloadForAI,
    hashString,
    getQuestionKey,
    getEliminatedOptions,
    recordWrongOptionFromDom,
    clearEliminatedOptions,
    findStrictNextButton,
    isRealNextButton,
    isTestFailed,
    updateStatus,
    getSettings: () => ({ ...currentSettings })
  };

})();
