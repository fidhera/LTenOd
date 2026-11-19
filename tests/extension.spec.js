/**
 * LTenOd v1.4 - Playwright Extension Tests
 *
 * Strategi:
 * - Extension dimuat via --load-extension pada Chromium persistent context.
 * - Halaman uji memakai file:// mock-pages (content script match "file:///*").
 * - Konten skrip berjalan di isolated world, jadi pengujian fungsi internal
 *   memakai CDP Runtime.evaluate pada execution context isolated tersebut.
 * - Perilaku end-to-end (klik solve tanpa API key) diuji lewat DOM utama.
 */

const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const MOCK_DIR = path.join(ROOT, 'mock-pages');

const EXTENSION_ARGS = [
  `--disable-extensions-except=${ROOT}`,
  `--load-extension=${ROOT}`,
  '--allow-file-access-from-files'
];

function mockUrl(file) {
  return pathToFileURL(path.join(MOCK_DIR, file)).href;
}

/**
 * Buka halaman mock + siapkan jembatan CDP ke isolated world content script.
 */
async function openMockPage(context, mockFile) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Runtime.enable');

  const isolatedContexts = [];
  cdp.on('Runtime.executionContextCreated', (e) => {
    if (e.context && e.context.auxData && e.context.auxData.type === 'isolated') {
      isolatedContexts.push(e.context);
    }
  });

  await page.goto(mockUrl(mockFile), { waitUntil: 'load' });
  await page.waitForSelector('#ltensolver-widget', { timeout: 15000 });
  await page.waitForTimeout(300); // beri waktu execution context terdaftar

  const world = isolatedContexts[isolatedContexts.length - 1];
  if (!world) {
    throw new Error('Isolated world content script tidak ditemukan (cek akses file URL).');
  }

  /** Evaluasi ekspresi di dalam isolated world content script. */
  async function evalCS(expression, { awaitPromise = false } = {}) {
    const res = await cdp.send('Runtime.evaluate', {
      expression,
      contextId: world.id,
      awaitPromise,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error('EvalCS exception: ' + JSON.stringify(res.exceptionDetails).slice(0, 400));
    }
    return res.result.value;
  }

  return { page, cdp, evalCS };
}

async function launchExtensionContext() {
  return chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: EXTENSION_ARGS
  });
}

/* ---------------------------------------------------------------------- */
/*  Widget & ekstraksi                                                    */
/* ---------------------------------------------------------------------- */

test.describe('LTenOd v1.4', () => {

  test('widget tampil pada halaman kuis mock', async () => {
    const context = await launchExtensionContext();
    try {
      const { page } = await openMockPage(context, 'praktikum-correct.html');
      await expect(page.locator('#ltensolver-widget')).toBeVisible();
      await expect(page.locator('#ltensolver-btn-solve')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('ekstraksi multichoice menghasilkan payload bersih tanpa referensi DOM', async () => {
    const context = await launchExtensionContext();
    try {
      const { evalCS } = await openMockPage(context, 'praktikum-ug-ac-id.html');

      const payload = await evalCS(
        `(async () => {
          const q = await window.__LTEN_OD_TEST__.extractQuestionData();
          return window.__LTEN_OD_TEST__.buildPayloadForAI(q);
        })()`,
        { awaitPromise: true }
      );

      expect(payload.type).toBe('multichoice');
      expect(Array.isArray(payload.options)).toBe(true);
      expect(payload.options.length).toBeGreaterThan(1);
      for (const opt of payload.options) {
        expect(opt).not.toHaveProperty('element');
        expect(opt).not.toHaveProperty('inputElement');
        expect(typeof opt.letter).toBe('string');
        expect(typeof opt.text).toBe('string');
        expect(opt.text.length).toBeGreaterThan(0);
      }
      expect(payload).not.toHaveProperty('container');
      expect(Array.isArray(payload.eliminatedOptions)).toBe(true);
    } finally {
      await context.close();
    }
  });

  test('ekstraksi soal matching menghasilkan item dan opsi', async () => {
    const context = await launchExtensionContext();
    try {
      const { evalCS } = await openMockPage(context, 'vclass-list-tr.html');

      const payload = await evalCS(
        `(async () => {
          const q = await window.__LTEN_OD_TEST__.extractQuestionData();
          return window.__LTEN_OD_TEST__.buildPayloadForAI(q);
        })()`,
        { awaitPromise: true }
      );

      expect(payload.type).toBe('matching');
      expect(Array.isArray(payload.items)).toBe(true);
      expect(payload.items.length).toBeGreaterThan(0);
      for (const item of payload.items) {
        expect(typeof item.itemText).toBe('string');
        expect(Array.isArray(item.options)).toBe(true);
      }
    } finally {
      await context.close();
    }
  });

  test('ekstraksi coderunner membawa starter code dan failedTests', async () => {
    const context = await launchExtensionContext();
    try {
      const { evalCS } = await openMockPage(context, 'praktikum-ug-ngoding.html');

      const payload = await evalCS(
        `(async () => {
          const q = await window.__LTEN_OD_TEST__.extractQuestionData();
          return window.__LTEN_OD_TEST__.buildPayloadForAI(q);
        })()`,
        { awaitPromise: true }
      );

      expect(payload.type).toBe('coderunner');
      expect(typeof payload.starterCode).toBe('string');
      expect(Array.isArray(payload.failedTests)).toBe(true);
      expect(typeof payload.lang).toBe('string');
    } finally {
      await context.close();
    }
  });

  test('isTestFailed mendeteksi kegagalan test case pada halaman coderunner incorrect', async () => {
    const context = await launchExtensionContext();
    try {
      const { evalCS } = await openMockPage(context, 'praktikum-ug-ngoding-incorrect.html');
      const failed = await evalCS(`window.__LTEN_OD_TEST__.isTestFailed()`);
      expect(failed).toBe(true);
    } finally {
      await context.close();
    }
  });

  test('eliminasi opsi salah: record, get, lalu clear', async () => {
    const context = await launchExtensionContext();
    try {
      const { page, evalCS } = await openMockPage(context, 'praktikum-correct.html');

      // Tandai satu radio sebagai terpilih lalu rekam sebagai opsi salah
      await page.evaluate(() => {
        const q = document.querySelector('.que');
        const radio = q.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
      });

      await evalCS(`window.__LTEN_OD_TEST__.recordWrongOptionFromDom(document.querySelector('.que'))`);

      const recorded = await evalCS(
        `window.__LTEN_OD_TEST__.getEliminatedOptions(document.querySelector('.que'))`
      );
      expect(Array.isArray(recorded)).toBe(true);
      expect(recorded.length).toBe(1);

      // Key konsisten untuk kontainer yang sama
      const key1 = await evalCS(`window.__LTEN_OD_TEST__.getQuestionKey(document.querySelector('.que'))`);
      const key2 = await evalCS(`window.__LTEN_OD_TEST__.getQuestionKey(document.querySelector('.que'))`);
      expect(key1).toBe(key2);

      await evalCS(`window.__LTEN_OD_TEST__.clearEliminatedOptions(document.querySelector('.que'))`);
      const afterClear = await evalCS(
        `window.__LTEN_OD_TEST__.getEliminatedOptions(document.querySelector('.que'))`
      );
      expect(afterClear.length).toBe(0);
    } finally {
      await context.close();
    }
  });

  test('isRealNextButton membedakan tombol next, previous, dan tryagain', async () => {
    const context = await launchExtensionContext();
    try {
      const { page, evalCS } = await openMockPage(context, 'praktikum-correct.html');

      await page.evaluate(() => {
        const next = document.createElement('button');
        next.id = 'mod_quiz-next-nav';
        next.value = 'Next page';
        document.body.appendChild(next);

        const prev = document.createElement('button');
        prev.name = 'previous';
        prev.value = 'Previous page';
        document.body.appendChild(prev);

        const retry = document.createElement('input');
        retry.type = 'submit';
        retry.name = 'q1:2_-tryagain';
        retry.value = 'Try again';
        document.body.appendChild(retry);
      });

      expect(await evalCS(`window.__LTEN_OD_TEST__.isRealNextButton(document.getElementById('mod_quiz-next-nav'))`)).toBe(true);
      expect(await evalCS(`window.__LTEN_OD_TEST__.isRealNextButton(document.querySelector('button[name="previous"]'))`)).toBe(false);
      expect(await evalCS(`window.__LTEN_OD_TEST__.isRealNextButton(document.querySelector('input[name$="-tryagain"]'))`)).toBe(false);
    } finally {
      await context.close();
    }
  });

  /* -------------------------------------------------------------------- */
  /*  End-to-end: tanpa API key, klik solve memunculkan diagnosa jelas     */
  /* -------------------------------------------------------------------- */

  test('klik solve tanpa API key menampilkan banner diagnosa', async () => {
    const context = await launchExtensionContext();
    try {
      const { page } = await openMockPage(context, 'praktikum-ug-ac-id.html');

      await page.click('#ltensolver-btn-solve');

      const banner = page.locator('#ltensolver-error-banner');
      await expect(banner).toBeVisible({ timeout: 20000 });
      await expect(banner).toContainText('API Key', { timeout: 5000 });
    } finally {
      await context.close();
    }
  });

  /* -------------------------------------------------------------------- */
  /*  Popup: fallback model dan statistik                                  */
  /* -------------------------------------------------------------------- */

  test('popup memuat, bisa menambah model cadangan, dan menampilkan statistik', async () => {
    const context = await launchExtensionContext();
    try {
      // Ambil ID ekstensi dari service worker background
      let [sw] = context.serviceWorkers();
      if (!sw) {
        sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
      }
      const extensionId = new URL(sw.url()).host;

      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

      await expect(page.locator('.version')).toHaveText('v1.4.0');

      // Tambah model cadangan
      await page.fill('#fallbackModelInput', 'gemini-2.5-flash');
      await page.click('#btnAddFallback');
      await expect(page.locator('#fallbackList li')).toHaveCount(1);
      await expect(page.locator('#fallbackCountBadge')).toHaveText('1 cadangan');

      // Hapus model cadangan
      await page.click('#fallbackList li button.fb-remove');
      await expect(page.locator('#fallbackList li')).toHaveCount(1); // kembali ke empty-state
      await expect(page.locator('#fallbackCountBadge')).toHaveText('0 cadangan');

      // Statistik awal (belum ada riwayat)
      await expect(page.locator('#statTotal')).toHaveText('0');
      await expect(page.locator('#statAccuracy')).toHaveText('0%');
    } finally {
      await context.close();
    }
  });

});
