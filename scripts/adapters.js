/**
 * LTenOd Site Adapters Configuration
 * Mendukung multiple website praktikum dan kuis Gunadarma:
 * - Soal Pilihan Ganda (.que.multichoice)
 * - Soal Koding / Praktikum CodeRunner (.que.coderunner)
 * - Mode Kuis Interaktif dengan Percobaan Ulang (Try Again / Adaptive)
 */

const SITE_ADAPTERS = [
  {
    id: 'gundar-praktikum',
    name: 'Praktikum Gunadarma (iLab)',
    match: (host, url) => host.includes('praktikum.gunadarma.ac.id') || (url && (
      url.includes('praktikum-ug-ac-id.html') ||
      url.includes('praktikum-ug-ngoding.html') ||
      url.includes('praktikum-tryagain.html') ||
      url.includes('praktikum-correct.html') ||
      url.includes('praktikum-incorrect.html')
    )),
    questionContainer: '.que.coderunner, .que.multichoice, .que',
    questionText: '.qtext',
    questionImages: '.qtext img',
    codeEditor: 'textarea.coderunner-answer, textarea.edit_code, textarea[name$="_answer"]',
    codeResetBtn: 'input.answer_reset_btn',
    codeExamples: '.coderunner-examples, table.coderunnerexamples',
    checkButton: 'input[name$="-submit"], button[name$="-submit"], input[id$="-submit"], button[id$="-submit"], input[value="Check"], button.submit',
    tryAgainButton: 'input[name$="-tryagain"], button[name$="-tryagain"], input[id$="-tryagain"], button[id$="-tryagain"], input[value="Try again"]',
    optionsContainer: '.answer',
    optionItems: '.answer .r0, .answer .r1, .answer > div:not(.qtype_multichoice_clearchoice)',
    optionInput: 'input[type="radio"], input[type="checkbox"]',
    optionLabel: 'div[data-region="answer-label"], .flex-fill, label',
    nextButton: 'input#mod_quiz-next-nav, input.mod_quiz-next-nav, input[name="next"], button[name="next"]',
    finishLink: '.endtestlink, a[href*="summary.php"], input[value*="Finish attempt"]'
  },
  {
    id: 'gundar-vclass',
    name: 'V-Class Gunadarma',
    match: (host, url) => host.includes('v-class.gunadarma.ac.id') || (url && url.includes('vclass-ac-id.html')),
    questionContainer: '.que.coderunner, .que.multichoice, .que',
    questionText: '.qtext',
    questionImages: '.qtext img',
    codeEditor: 'textarea.coderunner-answer, textarea.edit_code, textarea[name$="_answer"]',
    codeResetBtn: 'input.answer_reset_btn',
    codeExamples: '.coderunner-examples, table.coderunnerexamples',
    checkButton: 'input[name$="-submit"], button[name$="-submit"], input[id$="-submit"], button[id$="-submit"], input[value="Check"], button.submit',
    tryAgainButton: 'input[name$="-tryagain"], button[name$="-tryagain"], input[id$="-tryagain"], button[id$="-tryagain"], input[value="Try again"]',
    optionsContainer: '.answer',
    optionItems: '.answer .r0, .answer .r1, .answer > div:not(.qtype_multichoice_clearchoice)',
    optionInput: 'input[type="radio"], input[type="checkbox"]',
    optionLabel: '.flex-fill, div[data-region="answer-label"], label',
    nextButton: 'input#mod_quiz-next-nav, input.mod_quiz-next-nav, input[name="next"], button[name="next"]',
    finishLink: '.endtestlink, a[href*="summary.php"], input[value*="Finish attempt"]'
  },
  {
    id: 'gundar-iflab',
    name: 'Praktikum IFLab Gunadarma',
    match: (host) => host.includes('praktikum-iflab.gunadarma.ac.id'),
    questionContainer: '.que.coderunner, .que.multichoice, .que, .soal-item, .card-quiz',
    questionText: '.qtext, .pertanyaan, .soal-text',
    questionImages: '.qtext img, .pertanyaan img',
    codeEditor: 'textarea.coderunner-answer, textarea.edit_code, textarea[name$="_answer"]',
    codeResetBtn: 'input.answer_reset_btn',
    codeExamples: '.coderunner-examples, table.coderunnerexamples',
    checkButton: 'input[name$="-submit"], button[name$="-submit"], input[id$="-submit"], button[id$="-submit"], input[value="Check"], button.submit',
    tryAgainButton: 'input[name$="-tryagain"], button[name$="-tryagain"], input[id$="-tryagain"], button[id$="-tryagain"], input[value="Try again"]',
    optionsContainer: '.answer, .pilihan-jawaban, .options',
    optionItems: '.answer .r0, .answer .r1, .pilihan-item, .answer > div:not(.qtype_multichoice_clearchoice)',
    optionInput: 'input[type="radio"], input[type="checkbox"]',
    optionLabel: 'div[data-region="answer-label"], .flex-fill, label',
    nextButton: 'input#mod_quiz-next-nav, input.mod_quiz-next-nav, input[name="next"], button[name="next"], .btn-next, button.next',
    finishLink: '.endtestlink, a[href*="summary.php"], input[value*="Finish attempt"]'
  },
  {
    id: 'generic-moodle',
    name: 'Generic Moodle Exam',
    match: () => !!document.querySelector('.que .qtext, #responseform'),
    questionContainer: '.que.coderunner, .que.multichoice, .que',
    questionText: '.qtext',
    questionImages: '.qtext img',
    codeEditor: 'textarea.coderunner-answer, textarea.edit_code, textarea[name$="_answer"]',
    codeResetBtn: 'input.answer_reset_btn',
    codeExamples: '.coderunner-examples, table.coderunnerexamples',
    checkButton: 'input[name$="-submit"], button[name$="-submit"], input[id$="-submit"], button[id$="-submit"], input[value="Check"], button.submit',
    tryAgainButton: 'input[name$="-tryagain"], button[name$="-tryagain"], input[id$="-tryagain"], button[id$="-tryagain"], input[value="Try again"]',
    optionsContainer: '.answer',
    optionItems: '.answer .r0, .answer .r1, .answer > div:not(.qtype_multichoice_clearchoice)',
    optionInput: 'input[type="radio"]',
    optionLabel: 'div[data-region="answer-label"], .flex-fill, label',
    nextButton: 'input#mod_quiz-next-nav, input.mod_quiz-next-nav, input[name="next"], button[name="next"]',
    finishLink: '.endtestlink, a[href*="summary.php"], input[value*="Finish attempt"]'
  }
];

function getActiveAdapter() {
  const currentHost = window.location.hostname;
  const currentUrl = window.location.href;

  for (const adapter of SITE_ADAPTERS) {
    if (adapter.match(currentHost, currentUrl)) {
      return adapter;
    }
  }
  return null;
}
