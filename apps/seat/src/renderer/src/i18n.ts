import type { State } from '@saakshi/core/protocol';
import type { BindState, GateMethod, Lang } from '../../shared/ipc.ts';
import type { EnrolProblem } from './enrol-state.ts';
import type { BannerKind, Tick } from './exam-state.ts';

export interface Strings {
  title: string; candidate: string; form: string; start: string; startNote: string; question: string;
  timeLeft: string; timeUp: string; lang: string; palette: string; saveNext: string; markNext: string; clear: string;
  saved: string; online: string; offline: string; faces: string; cameraOff: string;
  exam: string; submit: string; confirmTitle: string; confirmNote: string; submitNow: string; back: string;
  receiptTitle: string; receiptCode: string; attempted: string; answered: string; marked: string;
  of: (n: number, total: number) => string; keepCode: string; print: string; submission: string; cameraTest: string;
  state: Record<State, string>; tick: Record<Tick, string>;
  connecting: string; enrolTitle: string; enrolNote: string; pin: string; pinConfirm: string; gateCheck: string; operator: string; method: string;
  methods: Record<GateMethod, string>; enrol: string; problems: Record<Exclude<EnrolProblem, ''>, string>;
  lockedTitle: string; lockedNote: string; commitment: string; bind: Record<BindState, string>;
  unlocked: string; viaCode: string; provisional: string; testBanner: string;
  banner: Record<BannerKind, string>; eta: (t: string) => string; preserved: (local: number, relay: number, cell: number) => string;
  moveTitle: string; moveNote: string; moveButton: string; movingTitle: string; movingNote: string; yourKey: string;
  movedTitle: string; movedNote: string; credited: (t: string, by: string) => string; awaitingApproval: (t: string) => string;
}

export const T: Record<Lang, Strings> = {
  en: {
    title: 'Saakshi exam', candidate: 'Candidate', form: 'Form', start: 'Start exam',
    startNote: 'Each answer is saved on this computer first, then at the centre server, then at the exam server. The ticks next to each question show how far it has reached.',
    question: 'Question', timeLeft: 'Time left', timeUp: 'Time is up. Please wait for the invigilator.', lang: 'Language',
    palette: 'Question palette', saveNext: 'Save & Next', markNext: 'Mark for Review & Next', clear: 'Clear Response',
    saved: 'Saved', online: 'Connected', offline: 'Offline — your answers are safe on this computer', faces: 'Faces', cameraOff: 'Camera unavailable',
    exam: 'Exam', submit: 'Submit', confirmTitle: 'Submit your exam?', confirmNote: 'You cannot change any answer after submitting.',
    submitNow: 'Submit now', back: 'Back to the questions', receiptTitle: 'Submission receipt', receiptCode: 'Receipt code',
    attempted: 'Attempted', answered: 'Answered', marked: 'Marked for review', of: (n, total) => `${n} of ${total}`,
    keepCode: 'Copy this code onto your admit card. With it you can check later that your answers were recorded exactly as you submitted them.',
    print: 'Print slip', submission: 'Your submission', cameraTest: 'Camera off (test mode)',
    state: { NV: 'Not visited', NA: 'Not answered', A: 'Answered', MR: 'Marked for review', AMR: 'Answered and marked for review (will be evaluated)' },
    tick: { none: '', local: 'saved on this computer', relay: 'saved at the centre server', cell: 'saved at the exam server' },
    connecting: 'Connecting to the centre server…',
    enrolTitle: 'Check-in',
    enrolNote: 'Set a 6-digit PIN. You need it only if you have to move to another computer. It is sent sealed to the exam server; the centre server cannot read it.',
    pin: 'New PIN (6 digits)', pinConfirm: 'Type the PIN again', gateCheck: 'Gate check (filled in by the gate operator)',
    operator: 'Gate operator ID', method: 'How the gate checked identity',
    methods: { 'aadhaar-face': 'Aadhaar face authentication', 'aadhaar-fingerprint': 'Aadhaar fingerprint', 'id-document': 'Photo ID checked by hand' },
    enrol: 'Check in',
    problems: { pinDigits: 'The PIN must be exactly 6 digits.', pinMatch: 'The two PINs do not match.', operator: "Enter the gate operator's ID." },
    lockedTitle: 'Paper locked until T0',
    lockedNote: 'The paper on this computer is encrypted. It opens only with a key that matches the commitment published before the exam:',
    commitment: 'Published commitment',
    bind: {
      none: 'Not checked in',
      provisional: 'Seat provisional — the exam server will confirm it when the network returns. Your answers are safe on this computer.',
      bound: 'Seat confirmed by the exam server',
      refused: 'Check-in refused — please call the invigilator',
      moving: 'Moving you to this seat — waiting for the invigilator',
    },
    unlocked: 'Paper unlocked: the key matches the published commitment.',
    viaCode: '(unlocked at this centre with the code phoned in by the superintendent)',
    provisional: 'provisional',
    testBanner: 'TEST MODE — not for real exams (journal key not in the OS keychain)',
    banner: {
      cell: 'The exam server is being restored from the centre\'s copy.',
      link: 'The centre\'s link to the exam server is down.',
      slow: 'The centre\'s link to the exam server is slow.',
      paused: 'This computer was asleep or locked, so your timer was paused.',
    },
    eta: (t) => `Expected back in about ${t}.`,
    preserved: (l, r, c) => `Your time and answers are preserved: ${l} saved on this computer · ${r} at the centre · ${c} at the exam server.`,
    moveTitle: 'Continue on this computer',
    moveNote: 'You are checked in on another computer. If it failed, type your PIN. The invigilator approves the move, and your answers and time come back here.',
    moveButton: 'Ask to continue here',
    movingTitle: 'Waiting for the invigilator',
    movingNote: 'The invigilator is checking your admit card and will approve the move at the centre console.',
    yourKey: 'This computer\'s key (the invigilator compares it)',
    movedTitle: 'You have moved to another computer',
    movedNote: 'Your exam continues on the other computer. Nothing typed here counts. Please call the invigilator.',
    credited: (t, by) => `+${t} credited · approved by ${by}`,
    awaitingApproval: (t) => `+${t} credited · awaiting approval`,
  },
  hi: {
    title: 'साक्षी परीक्षा', candidate: 'अभ्यर्थी', form: 'प्रश्न-पत्र', start: 'परीक्षा शुरू करें',
    startNote: 'हर उत्तर पहले इस कंप्यूटर पर, फिर केंद्र सर्वर पर और फिर परीक्षा सर्वर पर सहेजा जाता है। हर प्रश्न के पास के टिक बताते हैं कि उत्तर कहाँ तक पहुँचा है।',
    question: 'प्रश्न', timeLeft: 'शेष समय', timeUp: 'समय समाप्त। कृपया निरीक्षक की प्रतीक्षा करें।', lang: 'भाषा',
    palette: 'प्रश्न पैलेट', saveNext: 'सहेजें और आगे बढ़ें', markNext: 'समीक्षा हेतु चिह्नित करें और आगे बढ़ें', clear: 'उत्तर मिटाएँ',
    saved: 'सहेजा गया', online: 'जुड़ा हुआ', offline: 'ऑफ़लाइन — आपके उत्तर इस कंप्यूटर पर सुरक्षित हैं', faces: 'चेहरे', cameraOff: 'कैमरा उपलब्ध नहीं',
    exam: 'परीक्षा', submit: 'जमा करें', confirmTitle: 'क्या आप परीक्षा जमा करना चाहते हैं?', confirmNote: 'जमा करने के बाद कोई भी उत्तर बदला नहीं जा सकता।',
    submitNow: 'अभी जमा करें', back: 'प्रश्नों पर लौटें', receiptTitle: 'जमा करने की रसीद', receiptCode: 'रसीद कोड',
    attempted: 'प्रयास किए', answered: 'उत्तर दिए', marked: 'समीक्षा हेतु चिह्नित', of: (n, total) => `${total} में से ${n}`,
    keepCode: 'यह कोड अपने प्रवेश-पत्र पर लिख लें। इससे आप बाद में जाँच सकते हैं कि आपके उत्तर ठीक वैसे ही दर्ज हुए जैसे आपने जमा किए थे।',
    print: 'रसीद प्रिंट करें', submission: 'आपका जमा किया गया उत्तर-पत्र', cameraTest: 'कैमरा बंद (परीक्षण मोड)',
    state: { NV: 'नहीं देखा', NA: 'उत्तर नहीं दिया', A: 'उत्तर दिया', MR: 'समीक्षा हेतु चिह्नित', AMR: 'उत्तर दिया और समीक्षा हेतु चिह्नित (मूल्यांकन होगा)' },
    tick: { none: '', local: 'इस कंप्यूटर पर सहेजा गया', relay: 'केंद्र सर्वर पर सहेजा गया', cell: 'परीक्षा सर्वर पर सहेजा गया' },
    connecting: 'केंद्र सर्वर से जुड़ रहे हैं…',
    enrolTitle: 'चेक-इन',
    enrolNote: '6 अंकों का पिन बनाएँ। इसकी ज़रूरत केवल तब होगी जब आपको दूसरे कंप्यूटर पर जाना पड़े। यह परीक्षा सर्वर को सीलबंद भेजा जाता है; केंद्र सर्वर इसे पढ़ नहीं सकता।',
    pin: 'नया पिन (6 अंक)', pinConfirm: 'पिन दोबारा लिखें', gateCheck: 'गेट जाँच (गेट ऑपरेटर भरेंगे)',
    operator: 'गेट ऑपरेटर आईडी', method: 'गेट पर पहचान कैसे जाँची गई',
    methods: { 'aadhaar-face': 'आधार चेहरा प्रमाणीकरण', 'aadhaar-fingerprint': 'आधार फ़िंगरप्रिंट', 'id-document': 'फ़ोटो पहचान-पत्र हाथ से जाँचा गया' },
    enrol: 'चेक-इन करें',
    problems: { pinDigits: 'पिन ठीक 6 अंकों का होना चाहिए।', pinMatch: 'दोनों पिन मेल नहीं खाते।', operator: 'गेट ऑपरेटर की आईडी लिखें।' },
    lockedTitle: 'T0 तक प्रश्न-पत्र बंद है',
    lockedNote: 'इस कंप्यूटर पर प्रश्न-पत्र एन्क्रिप्टेड है। यह केवल उसी कुंजी से खुलेगा जो परीक्षा से पहले प्रकाशित प्रतिबद्धता से मेल खाती है:',
    commitment: 'प्रकाशित प्रतिबद्धता',
    bind: {
      none: 'चेक-इन नहीं हुआ',
      provisional: 'सीट अस्थायी है — नेटवर्क लौटने पर परीक्षा सर्वर इसकी पुष्टि करेगा। आपके उत्तर इस कंप्यूटर पर सुरक्षित हैं।',
      bound: 'परीक्षा सर्वर ने सीट की पुष्टि की',
      refused: 'चेक-इन अस्वीकार — कृपया निरीक्षक को बुलाएँ',
      moving: 'आपको इस सीट पर ले जाया जा रहा है — निरीक्षक की प्रतीक्षा करें',
    },
    unlocked: 'प्रश्न-पत्र खुल गया: कुंजी प्रकाशित प्रतिबद्धता से मेल खाती है।',
    viaCode: '(अधीक्षक द्वारा फ़ोन पर बताए गए कोड से इसी केंद्र पर खोला गया)',
    provisional: 'अस्थायी',
    testBanner: 'परीक्षण मोड — असली परीक्षा के लिए नहीं (जर्नल कुंजी OS कीचेन में नहीं है)',
    banner: {
      cell: 'परीक्षा सर्वर को केंद्र की प्रति से बहाल किया जा रहा है।',
      link: 'केंद्र का परीक्षा सर्वर से संपर्क टूट गया है।',
      slow: 'केंद्र का परीक्षा सर्वर से संपर्क धीमा है।',
      paused: 'यह कंप्यूटर सो गया था या लॉक था, इसलिए आपका समय रुका रहा।',
    },
    eta: (t) => `लगभग ${t} में वापस आने की उम्मीद है।`,
    preserved: (l, r, c) => `आपका समय और उत्तर सुरक्षित हैं: इस कंप्यूटर पर ${l} · केंद्र पर ${r} · परीक्षा सर्वर पर ${c} सहेजे गए।`,
    moveTitle: 'इस कंप्यूटर पर जारी रखें',
    moveNote: 'आपका चेक-इन किसी दूसरे कंप्यूटर पर है। यदि वह खराब हो गया है, तो अपना PIN टाइप करें। निरीक्षक स्थानांतरण स्वीकृत करेंगे, और आपके उत्तर व समय यहाँ वापस आ जाएँगे।',
    moveButton: 'यहाँ जारी रखने का अनुरोध करें',
    movingTitle: 'निरीक्षक की प्रतीक्षा',
    movingNote: 'निरीक्षक आपका प्रवेश पत्र जाँच रहे हैं और केंद्र कंसोल पर स्थानांतरण स्वीकृत करेंगे।',
    yourKey: 'इस कंप्यूटर की कुंजी (निरीक्षक इसका मिलान करेंगे)',
    movedTitle: 'आप दूसरे कंप्यूटर पर चले गए हैं',
    movedNote: 'आपकी परीक्षा दूसरे कंप्यूटर पर जारी है। यहाँ टाइप किया गया कुछ भी नहीं गिना जाएगा। कृपया निरीक्षक को बुलाएँ।',
    credited: (t, by) => `+${t} जोड़ा गया · ${by} द्वारा स्वीकृत`,
    awaitingApproval: (t) => `+${t} जोड़ा गया · स्वीकृति की प्रतीक्षा`,
  },
};
