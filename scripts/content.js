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

    const qContainer = document.querySelector(adapter.questionContainer);

    // =========================================================================
    // 1. CEK APAKAH SOAL SAAT INI SUDAH BENAR (CORRECT)
    // =========================================================================
    if (qContainer) {
      const isCorrect = qContainer.classList.contains('correct') ||
        (qContainer.querySelector('.state')?.innerText || '').toLowerCase().includes('correct') ||
        (!!qContainer.querySelector('.fa-circle-check.text-success') && !qContainer.querySelector('.fa-circle-xmark.text-danger'));

      if (isCorrect) {
        clearEliminatedOptions(qContainer);
        sessionStorage.removeItem('ltensolver_code_retries');
        footerStatus.textContent = 'Jawaban BENAR (Correct)! Melanjutkan ke soal berikutnya...';
        footerStatus.style.color = '#34d399';
        playChimeSound(880);

        if (currentSettings.solveMode === 'auto') {
          btnSolve.classList.remove('loading');
          setTimeout(() => executeNextPageClick(), 1000);
          return;
        } else {
          btnSolve.classList.remove('loading');
          return;
        }
      }

      // =======================================================================
      // 2. CEK APAKAH ADA TOMBOL "TRY AGAIN" (JAWABAN SALAH & ADA KESEMPATAN)
      // =======================================================================
      const tryAgainBtn = document.querySelector(adapter.tryAgainButton || 'input[name$="-tryagain"], input[value="Try again"], button.tryagain');
      if (tryAgainBtn) {
        recordWrongOptionFromDom(qContainer);

        footerStatus.textContent = 'Jawaban salah. Menekan Try again untuk mencoba pilihan lain...';
        footerStatus.style.color = '#f59e0b';
        playChimeSound(440);

        btnSolve.classList.remove('loading');
        setTimeout(() => {
          tryAgainBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          tryAgainBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          tryAgainBtn.click();
        }, 800);
        return;
      }

      // =======================================================================
      // 3. CEK APAKAH SOAL FINAL INCORRECT (KESEMPATAN MENCOBA HABIS)
      // =======================================================================
      const isFinalIncorrect = (
        qContainer.classList.contains('incorrect') ||
        (qContainer.querySelector('.state')?.innerText || '').toLowerCase().includes('incorrect')
      ) && !tryAgainBtn && !document.querySelector('.coderunner-test-results');

      if (isFinalIncorrect) {
        clearEliminatedOptions(qContainer);
        footerStatus.textContent = 'Kesempatan menjawab telah habis. Melanjutkan ke soal berikutnya...';
        footerStatus.style.color = '#f87171';

        if (currentSettings.solveMode === 'auto') {
          btnSolve.classList.remove('loading');
          setTimeout(() => executeNextPageClick(), 1500);
          return;
        } else {
          btnSolve.classList.remove('loading');
          return;
        }
      }
    }

    // =========================================================================
    // 4. CEK HASIL EVALUASI CODERUNNER (KODING)
    // =========================================================================
    const testResults = document.querySelector('.coderunner-test-results');
    const isCodeRunnerQuestion = !!document.querySelector('.que.coderunner, textarea.coderunner-answer, .ui_wrapper .ace_editor');

    if (isCodeRunnerQuestion && testResults) {
      const isBad = testResults.classList.contains('bad') ||
        !!document.querySelector('.im-feedback .incorrect') ||
        !!testResults.querySelector('.text-danger, .fa-circle-xmark, [title*="Incorrect"]');

      if (!isBad && testResults.querySelector('.text-success, .fa-circle-check, [title*="Correct"]')) {
        sessionStorage.removeItem('ltensolver_code_retries');
        footerStatus.textContent = 'Semua test case lolos 100%! Melanjutkan ke soal berikutnya...';
        footerStatus.style.color = '#34d399';
        playChimeSound(880);

        if (currentSettings.solveMode === 'auto') {
          btnSolve.classList.remove('loading');
          setTimeout(() => executeNextPageClick(), 1000);
          return;
        } else {
          btnSolve.classList.remove('loading');
          return;
        }
      } else if (isBad) {
        // Klik tombol "Show differences" jika ada agar perbedaan Expected vs Got terlihat jelas
        const diffBtn = document.querySelector(adapter.codeDiffBtn || 'input[name$="-diffbutton"], button[name$="-diffbutton"], input[value*="differences"]');
        if (diffBtn && (diffBtn.value || '').toLowerCase().includes('show differences')) {
          try {
            diffBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            diffBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            diffBtn.click();
          } catch(e) {}
        }

        let codeRetries = parseInt(sessionStorage.getItem('ltensolver_code_retries') || '0', 10);
        if (codeRetries >= 5) {
          sessionStorage.removeItem('ltensolver_code_retries');
          stopAutoLoop('Telah mencoba 5x perbaikan otomatis. Periksa rincian perbedaan Expected vs Got di halaman.');
          btnSolve.classList.remove('loading');
          return;
        }
        codeRetries++;
        sessionStorage.setItem('ltensolver_code_retries', String(codeRetries));
        footerStatus.textContent = `Menganalisa perbedaan (Show diff) & memperbaiki kode (${codeRetries}/5)...`;
        footerStatus.style.color = '#f59e0b';
      }
    }

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
      const isFixingCode = questionData.failedTests && questionData.failedTests.length > 0;
      if (questionData.type === 'coderunner') {
        footerStatus.textContent = isFixingCode ?
          'Memperbaiki kode via AI (menganalisis Expected vs Got)...' :
          'Menyusun solusi koding via AI...';
      } else {
        footerStatus.textContent = 'Menganalisis jawaban via AI...';
      }

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

    // Deteksi apakah tipe soal adalah CodeRunner (koding / praktikum program)
    const isCodeRunner = qContainer.classList.contains('coderunner') ||
      !!qContainer.querySelector('textarea.coderunner-answer, textarea.edit_code, .ui_wrapper .ace_editor, table.coderunnerexamples');

    if (isCodeRunner) {
      return await extractCodeRunnerData(qContainer);
    }

    return await extractMultiChoiceData(qContainer);
  }

  /**
   * Ekstraksi Soal Praktikum Koding (CodeRunner / Ace Editor)
   * Dilengkapi deteksi kegagalan test case (Expected vs Got) untuk auto-refine / auto-fix
   */
  async function extractCodeRunnerData(qContainer) {
    const qTextEl = qContainer.querySelector(adapter.questionText || '.qtext');
    let questionText = qTextEl ? qTextEl.innerText.trim() : '';

    // Ambil contoh test case bawaan jika ada tabel coderunnerexamples
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

    // Ambil starter code dari reset button data-reload-text
    const textarea = qContainer.querySelector(adapter.codeEditor || 'textarea.coderunner-answer, textarea.edit_code, textarea[name$="_answer"]');
    const resetBtn = qContainer.querySelector(adapter.codeResetBtn || 'input.answer_reset_btn');

    let starterCode = '';
    if (resetBtn && resetBtn.getAttribute('data-reload-text')) {
      starterCode = resetBtn.getAttribute('data-reload-text').trim();
    }

    // Ambil kode yang sedang ada di editor saat ini
    let currentCode = '';
    if (textarea && textarea.value && textarea.value.trim().length > 0) {
      currentCode = textarea.value.trim();
    }
    if (!starterCode) {
      starterCode = currentCode;
    }

    // Ekstraksi hasil evaluasi test case yang gagal jika ada (.coderunner-test-results)
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

    const imgElements = qContainer.querySelectorAll(adapter.questionImages || '.qtext img');
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

  function cleanCellText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, .xy-copy-button, .visually-hidden, .fa, .icon').forEach(n => n.remove());
    return clone.innerText.trim();
  }

  /**
   * Helper Penyimpanan Opsi Tereliminasi (Memory Learning AI)
   */
  function getQuestionKey(qContainer) {
    if (!qContainer) return 'default_q';
    return (qContainer.id || document.querySelector('input[name="slots"]')?.value || 'slot') + '_' + (document.querySelector('input[name="attempt"]')?.value || '');
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
    } catch {}
  }

  /**
   * Ekstraksi Soal Pilihan Ganda (Multichoice)
   */
  async function extractMultiChoiceData(qContainer) {
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

  /**
   * Menerapkan Jawaban (Bercabang: Koding vs Pilihan Ganda)
   */
  async function applyAnswer(questionData, result) {
    if (questionData.type === 'coderunner' || result.type === 'coderunner') {
      await applyCodeRunnerAnswer(questionData, result);
      return;
    }

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

    // Cari tombol Check jika tersedia pada tipe soal interactive / adaptive
    const checkBtn = document.querySelector(adapter.checkButton || 'input[name$="-submit"], button[name$="-submit"], input[id$="-submit"], button[id$="-submit"], input[value="Check"]');

    // Mode Otomatis (Lepas Tangan Penuh - Tanpa Jeda Ragu)
    if (currentSettings.solveMode === 'auto') {
      const minD = Math.max(1, currentSettings.minDelay);
      const maxD = Math.max(minD, currentSettings.maxDelay);
      const delaySec = Math.floor(Math.random() * (maxD - minD + 1) + minD);

      let timeLeft = delaySec;

      if (checkBtn) {
        footerStatus.textContent = `Jawaban ${result.huruf_jawaban} dipilih. Menjalankan Check dalam ${timeLeft}s...`;
        footerStatus.style.color = '#34d399';

        if (activeCountdownTimer) clearInterval(activeCountdownTimer);

        activeCountdownTimer = setInterval(() => {
          timeLeft--;
          if (timeLeft > 0) {
            footerStatus.textContent = `Jawaban ${result.huruf_jawaban} dipilih. Menjalankan Check dalam ${timeLeft}s...`;
          } else {
            clearInterval(activeCountdownTimer);
            activeCountdownTimer = null;
            footerStatus.textContent = 'Menjalankan Check...';
            checkBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            checkBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            checkBtn.click();
          }
        }, 1000);
      } else {
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
      }

    } else {
      if (checkBtn) {
        footerStatus.textContent = `Opsi ${result.huruf_jawaban} dipilih. Silakan klik Check.`;
      } else {
        footerStatus.textContent = `Opsi ${result.huruf_jawaban} ditandai (Highlight Mode)`;
      }
      footerStatus.style.color = '#34d399';
    }
  }

  /**
   * Menerapkan Solusi Koding ke Textarea & Ace Editor CodeRunner
   */
  async function applyCodeRunnerAnswer(questionData, result) {
    const footerStatus = document.getElementById('ltensolver-footer-status');
    const solutionCode = result.code || '';

    if (!solutionCode) {
      footerStatus.textContent = 'Kode jawaban kosong dari AI.';
      footerStatus.style.color = '#f87171';
      stopAutoLoop('Gagal mendapatkan kode solusi koding.');
      return;
    }

    const hasFailedTests = questionData.failedTests && questionData.failedTests.length > 0;
    const shouldReset = hasFailedTests || result.isFix;

    if (shouldReset) {
      footerStatus.textContent = 'Mereset kodingan lama & memasukkan kode solusi perbaikan AI...';
    } else {
      footerStatus.textContent = 'Memasukkan kode solusi AI ke dalam editor...';
    }
    footerStatus.style.color = '#38bdf8';

    // Suntikkan kode ke Textarea dan Ace Editor (dengan auto-reset jika sedang perbaikan)
    injectCodeToCodeRunner(questionData.textareaId, solutionCode, shouldReset);

    // Sorot area editor dengan efek glow
    const editorWrapper = document.querySelector('.ui_wrapper') || document.getElementById(questionData.textareaId);
    if (editorWrapper) {
      editorWrapper.classList.add('ltensolver-code-active');
      editorWrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    playChimeSound(660);

    // Temukan tombol Check CodeRunner
    const checkBtn = document.querySelector(adapter.checkButton || 'button.submit[name$="-submit"], input.submit[name$="-submit"], button[id$="-submit"]');

    if (currentSettings.solveMode === 'auto') {
      if (checkBtn) {
        const minD = Math.max(1, currentSettings.minDelay);
        const maxD = Math.max(minD, currentSettings.maxDelay);
        const delaySec = Math.floor(Math.random() * (maxD - minD + 1) + minD);

        let timeLeft = delaySec;
        footerStatus.textContent = `Kode terisi. Menjalankan Check dalam ${timeLeft}s...`;
        footerStatus.style.color = '#34d399';

        if (activeCountdownTimer) clearInterval(activeCountdownTimer);

        activeCountdownTimer = setInterval(() => {
          timeLeft--;
          if (timeLeft > 0) {
            footerStatus.textContent = `Kode terisi. Menjalankan Check dalam ${timeLeft}s...`;
          } else {
            clearInterval(activeCountdownTimer);
            activeCountdownTimer = null;
            footerStatus.textContent = 'Menjalankan Check...';
            // Klik tombol Check tepat satu kali
            checkBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            checkBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            checkBtn.click();
          }
        }, 1000);
      } else {
        const nextBtn = findStrictNextButton();
        if (nextBtn) {
          executeNextPageClick();
        } else {
          checkAutoSubmitGuard();
        }
      }
    } else {
      footerStatus.textContent = 'Kode koding berhasil diisi. Silakan periksa lalu klik Check.';
      footerStatus.style.color = '#34d399';
    }
  }

  /**
   * Injeksi kode ke textarea dan window.ace pada konteks halaman,
   * dengan dukungan auto-reset tombol "Reset answer" (bypassing window.confirm).
   */
  function injectCodeToCodeRunner(textareaId, code, shouldReset = false) {
    // 1. Set textarea langsung di Content Script context
    const ta = (textareaId ? document.getElementById(textareaId) : null) ||
      document.querySelector('textarea.coderunner-answer, textarea.edit_code, textarea[name$="_answer"]');
    if (ta) {
      ta.value = code;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 2. Set Ace Editor di Page Execution context (window.ace) & Handle Reset jika ada
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

  /**
   * PENCEGAHAN DOUBLE SUBMIT:
   * Hanya melakukan klik satu kali pada tombol submit Moodle dan mengunci navigasi
   * sampai halaman baru termuat. TIDAK PERNAH memanggil requestSubmit() cadangan
   * yang dapat merusak sequence Moodle.
   */
  function executeNextPageClick() {
    if (isNavigating) return;

    // GUARD SOAL KODING: Jangan pernah klik Next Page jika test case masih ada yang gagal
    const isCodeRunner = !!document.querySelector('.que.coderunner, textarea.coderunner-answer, .ui_wrapper .ace_editor');
    const testResults = document.querySelector('.coderunner-test-results');
    if (isCodeRunner && testResults) {
      const isBad = testResults.classList.contains('bad') ||
        !!document.querySelector('.im-feedback .incorrect') ||
        !!testResults.querySelector('.text-danger, .fa-circle-xmark, [title*="Incorrect"]');
      if (isBad) {
        console.warn('[LTenOd] Menahan Next Page: Soal koding belum lulus semua test case.');
        return;
      }
    }

    // GUARD INTERACTIVE QUIZ: Jangan pernah klik Next Page jika tombol "Try again" aktif
    const tryAgainBtn = document.querySelector(adapter.tryAgainButton || 'input[name$="-tryagain"], input[value="Try again"], button.tryagain');
    if (tryAgainBtn) {
      console.warn('[LTenOd] Menahan Next Page: Masih ada kesempatan mencoba ulang (Try again).');
      return;
    }

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

  function displayResult(result) {
    const resultBox = document.getElementById('ltensolver-result-box');
    const choiceEl = document.getElementById('ltensolver-result-choice');
    const confEl = document.getElementById('ltensolver-result-conf');
    const descEl = document.getElementById('ltensolver-result-desc');

    resultBox.style.display = 'block';

    if (result.type === 'coderunner') {
      choiceEl.textContent = result.isFix ? 'Perbaikan Koding Selesai' : 'Solusi Koding Siap';
      confEl.textContent = result.isFix ? 'Refined' : 'Koding';
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
      descEl.textContent = `${result.explanation || (result.isFix ? 'Kode berhasil diperbaiki berdasarkan output test case.' : 'Kode program berhasil diisikan ke editor CodeRunner.')}${modelLabel}`;
      return;
    }

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
