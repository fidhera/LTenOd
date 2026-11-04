/**
 * LTenOd Site Adapters Configuration
 * Mendukung multiple website praktikum dan kuis Gunadarma.
 */

const SITE_ADAPTERS = [
  {
    id: 'gundar-praktikum',
    name: 'Praktikum Gunadarma (iLab)',
    match: (host, url) => host.includes('praktikum.gunadarma.ac.id') || url.includes('praktikum-ug-ac-id.html'),
    questionContainer: '.que.multichoice, .que',
    questionText: '.qtext',
    questionImages: '.qtext img',
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
    match: (host) => host.includes('v-class.gunadarma.ac.id'),
    questionContainer: '.que.multichoice, .que',
    questionText: '.qtext',
    questionImages: '.qtext img',
    optionsContainer: '.answer',
    optionItems: '.answer .r0, .answer .r1, .answer > div:not(.qtype_multichoice_clearchoice)',
    optionInput: 'input[type="radio"], input[type="checkbox"]',
    optionLabel: 'div[data-region="answer-label"], .flex-fill, label',
    nextButton: 'input#mod_quiz-next-nav, input.mod_quiz-next-nav, input[name="next"], button[name="next"]',
    finishLink: '.endtestlink, a[href*="summary.php"], input[value*="Finish attempt"]'
  },
  {
    id: 'gundar-iflab',
    name: 'Praktikum IFLab Gunadarma',
    match: (host) => host.includes('praktikum-iflab.gunadarma.ac.id'),
    questionContainer: '.que.multichoice, .que, .soal-item, .card-quiz',
    questionText: '.qtext, .pertanyaan, .soal-text',
    questionImages: '.qtext img, .pertanyaan img',
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
    questionContainer: '.que',
    questionText: '.qtext',
    questionImages: '.qtext img',
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
