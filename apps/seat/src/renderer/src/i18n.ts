import type { State } from '@saakshi/core/protocol';
import type { Level, Verdict } from '@saakshi/core/integrity';
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
  gate: {
    title: string; recheck: string; blockedNote: string; checkedAt: (at: number) => string;
    verdict: Record<Verdict, string>; level: Record<Level, string>;
  };
  /** Shown when the current question has no text in the seat's chosen language (Tamil is not yet in the bank). */
  questionLangNote: string;
}

// TA strings reviewed by: ______

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
    gate: {
      title: 'Integrity check', recheck: 'Check again', blockedNote: 'Close the named tools, then check again.',
      checkedAt: (at) => (at ? `Last checked ${new Date(at).toLocaleTimeString()}` : 'Not yet checked'),
      verdict: { green: 'Ready', amber: 'Amber', review: 'Review', block: 'Blocked' },
      level: { block: 'block', review: 'review', amber: 'amber', info: 'info' },
    },
    questionLangNote: 'Question text is shown in English; Tamil question text is not available yet.',
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
    gate: {
      title: 'सुरक्षा जाँच', recheck: 'फिर से जाँचें', blockedNote: 'नामित उपकरण बंद करें, फिर से जाँचें।',
      checkedAt: (at) => (at ? `अंतिम जाँच ${new Date(at).toLocaleTimeString()}` : 'अभी तक जाँच नहीं हुई'),
      verdict: { green: 'तैयार', amber: 'एम्बर', review: 'समीक्षा', block: 'अवरुद्ध' },
      level: { block: 'अवरुद्ध', review: 'समीक्षा', amber: 'एम्बर', info: 'सूचना' },
    },
    questionLangNote: 'प्रश्न अंग्रेज़ी में दिखाया गया है; तमिल में प्रश्न अभी उपलब्ध नहीं है।',
  },
  ta: {
    title: 'சாக்ஷி தேர்வு', candidate: 'தேர்வர்', form: 'வினாத்தாள்', start: 'தேர்வைத் தொடங்கு',
    startNote: 'ஒவ்வொரு பதிலும் முதலில் இந்தக் கணினியில், பின்னர் மைய சேவையகத்தில், பின்னர் தேர்வு சேவையகத்தில் சேமிக்கப்படும். ஒவ்வொரு கேள்விக்கு அருகிலும் உள்ள குறிகள் அது எவ்வளவு தூரம் சென்றது என்பதைக் காட்டும்.',
    question: 'கேள்வி', timeLeft: 'மீதமுள்ள நேரம்', timeUp: 'நேரம் முடிந்தது. மேற்பார்வையாளரிடம் காத்திருக்கவும்.', lang: 'மொழி',
    palette: 'கேள்வி பலகை', saveNext: 'சேமித்து அடுத்தது', markNext: 'மறுஆய்வுக்குக் குறித்து அடுத்தது', clear: 'பதிலை அழி',
    saved: 'சேமிக்கப்பட்டது', online: 'இணைக்கப்பட்டுள்ளது', offline: 'இணைப்பில்லை — உங்கள் பதில்கள் இந்தக் கணினியில் பாதுகாப்பாக உள்ளன', faces: 'முகங்கள்', cameraOff: 'கேமரா இல்லை',
    exam: 'தேர்வு', submit: 'சமர்ப்பி', confirmTitle: 'உங்கள் தேர்வைச் சமர்ப்பிக்கவா?', confirmNote: 'சமர்ப்பித்த பிறகு எந்தப் பதிலையும் மாற்ற முடியாது.',
    submitNow: 'இப்போது சமர்ப்பி', back: 'கேள்விகளுக்குத் திரும்பு', receiptTitle: 'சமர்ப்பிப்பு ரசீது', receiptCode: 'ரசீது குறியீடு',
    attempted: 'முயற்சிக்கப்பட்டது', answered: 'பதிலளிக்கப்பட்டது', marked: 'மறுஆய்வுக்குக் குறிக்கப்பட்டது', of: (n, total) => `${total} இல் ${n}`,
    keepCode: 'இந்தக் குறியீட்டை உங்கள் அனுமதி அட்டையில் எழுதிக் கொள்ளுங்கள். இதன் மூலம் நீங்கள் சமர்ப்பித்தபடியே உங்கள் பதில்கள் பதிவாகியுள்ளதா என்று பின்னர் சரிபார்க்கலாம்.',
    print: 'சீட்டை அச்சிடு', submission: 'உங்கள் சமர்ப்பிப்பு', cameraTest: 'கேமரா அணைக்கப்பட்டது (சோதனை முறை)',
    state: { NV: 'பார்க்கப்படவில்லை', NA: 'பதிலளிக்கப்படவில்லை', A: 'பதிலளிக்கப்பட்டது', MR: 'மறுஆய்வுக்குக் குறிக்கப்பட்டது', AMR: 'பதிலளிக்கப்பட்டு மறுஆய்வுக்குக் குறிக்கப்பட்டது (மதிப்பிடப்படும்)' },
    tick: { none: '', local: 'இந்தக் கணினியில் சேமிக்கப்பட்டது', relay: 'மைய சேவையகத்தில் சேமிக்கப்பட்டது', cell: 'தேர்வு சேவையகத்தில் சேமிக்கப்பட்டது' },
    connecting: 'மைய சேவையகத்துடன் இணைக்கிறது…',
    enrolTitle: 'செக்-இன்',
    enrolNote: '6 இலக்க பின் ஒன்றை அமைக்கவும். வேறு கணினிக்குச் செல்ல வேண்டியிருந்தால் மட்டும் இது தேவை. இது முத்திரையிடப்பட்டு தேர்வு சேவையகத்திற்கு அனுப்பப்படும்; மைய சேவையகம் இதைப் படிக்க முடியாது.',
    pin: 'புதிய பின் (6 இலக்கங்கள்)', pinConfirm: 'பின்னை மீண்டும் தட்டச்சு செய்யவும்', gateCheck: 'நுழைவு சரிபார்ப்பு (நுழைவு இயக்குபவர் நிரப்புவார்)',
    operator: 'நுழைவு இயக்குபவர் அடையாள எண்', method: 'நுழைவில் அடையாளம் எப்படி சரிபார்க்கப்பட்டது',
    methods: { 'aadhaar-face': 'ஆதார் முக அங்கீகாரம்', 'aadhaar-fingerprint': 'ஆதார் விரல்ரேகை', 'id-document': 'கையால் சரிபார்க்கப்பட்ட புகைப்பட அடையாள அட்டை' },
    enrol: 'செக்-இன் செய்',
    problems: { pinDigits: 'பின் சரியாக 6 இலக்கங்களாக இருக்க வேண்டும்.', pinMatch: 'இரண்டு பின்களும் பொருந்தவில்லை.', operator: 'நுழைவு இயக்குபவரின் அடையாள எண்ணை உள்ளிடவும்.' },
    lockedTitle: 'T0 வரை வினாத்தாள் பூட்டப்பட்டுள்ளது',
    lockedNote: 'இந்தக் கணினியில் உள்ள வினாத்தாள் மறையாக்கம் செய்யப்பட்டுள்ளது. தேர்வுக்கு முன் வெளியிடப்பட்ட உறுதிமொழியுடன் பொருந்தும் திறவுகோலால் மட்டுமே இது திறக்கும்:',
    commitment: 'வெளியிடப்பட்ட உறுதிமொழி',
    bind: {
      none: 'செக்-இன் செய்யப்படவில்லை',
      provisional: 'இருக்கை தற்காலிகமானது — வலையமைப்பு திரும்பியதும் தேர்வு சேவையகம் இதை உறுதிசெய்யும். உங்கள் பதில்கள் இந்தக் கணினியில் பாதுகாப்பாக உள்ளன.',
      bound: 'தேர்வு சேவையகத்தால் இருக்கை உறுதிசெய்யப்பட்டது',
      refused: 'செக்-இன் மறுக்கப்பட்டது — மேற்பார்வையாளரை அழைக்கவும்',
      moving: 'உங்களை இந்த இருக்கைக்கு மாற்றுகிறோம் — மேற்பார்வையாளருக்குக் காத்திருக்கவும்',
    },
    unlocked: 'வினாத்தாள் திறக்கப்பட்டது: திறவுகோல் வெளியிடப்பட்ட உறுதிமொழியுடன் பொருந்துகிறது.',
    viaCode: '(அதிபர் தொலைபேசியில் தெரிவித்த குறியீட்டைக் கொண்டு இந்த மையத்தில் திறக்கப்பட்டது)',
    provisional: 'தற்காலிகம்',
    testBanner: 'சோதனை முறை — உண்மையான தேர்வுகளுக்கு அல்ல (ஜர்னல் திறவுகோல் OS கீசெயினில் இல்லை)',
    banner: {
      cell: 'மைய சேவையகத்தின் நகலிலிருந்து தேர்வு சேவையகம் மீட்டமைக்கப்படுகிறது.',
      link: 'மைய சேவையகத்திற்கும் தேர்வு சேவையகத்திற்கும் இடையிலான இணைப்பு துண்டிக்கப்பட்டுள்ளது.',
      slow: 'மைய சேவையகத்திற்கும் தேர்வு சேவையகத்திற்கும் இடையிலான இணைப்பு மெதுவாக உள்ளது.',
      paused: 'இந்தக் கணினி உறங்கியிருந்தது அல்லது பூட்டப்பட்டிருந்தது, எனவே உங்கள் நேரம் நிறுத்தப்பட்டது.',
    },
    eta: (t) => `கிட்டத்தட்ட ${t} இல் திரும்பும் என எதிர்பார்க்கப்படுகிறது.`,
    preserved: (l, r, c) => `உங்கள் நேரமும் பதில்களும் பாதுகாக்கப்பட்டுள்ளன: இந்தக் கணினியில் ${l} · மையத்தில் ${r} · தேர்வு சேவையகத்தில் ${c} சேமிக்கப்பட்டன.`,
    moveTitle: 'இந்தக் கணினியில் தொடரவும்',
    moveNote: 'நீங்கள் வேறொரு கணினியில் செக்-இன் செய்யப்பட்டுள்ளீர்கள். அது செயலிழந்தால், உங்கள் பின்னைத் தட்டச்சு செய்யவும். மேற்பார்வையாளர் மாற்றத்தை அங்கீகரிப்பார்; உங்கள் பதில்களும் நேரமும் இங்கே திரும்பும்.',
    moveButton: 'இங்கு தொடர கோரிக்கை வை',
    movingTitle: 'மேற்பார்வையாளருக்குக் காத்திருக்கிறது',
    movingNote: 'மேற்பார்வையாளர் உங்கள் அனுமதி அட்டையைச் சரிபார்த்து மைய கன்சோலில் மாற்றத்தை அங்கீகரிப்பார்.',
    yourKey: 'இந்தக் கணினியின் திறவுகோல் (மேற்பார்வையாளர் இதை ஒப்பிடுவார்)',
    movedTitle: 'நீங்கள் வேறொரு கணினிக்கு மாற்றப்பட்டுள்ளீர்கள்',
    movedNote: 'உங்கள் தேர்வு மற்றொரு கணினியில் தொடர்கிறது. இங்கே தட்டச்சு செய்யப்படும் எதுவும் கணக்கிடப்படாது. மேற்பார்வையாளரை அழைக்கவும்.',
    credited: (t, by) => `+${t} சேர்க்கப்பட்டது · ${by} அங்கீகரித்தார்`,
    awaitingApproval: (t) => `+${t} சேர்க்கப்பட்டது · அங்கீகாரத்திற்குக் காத்திருக்கிறது`,
    gate: {
      title: 'ஒருமைப்பாடு சரிபார்ப்பு', recheck: 'மீண்டும் சரிபார்', blockedNote: 'பெயரிடப்பட்ட கருவிகளை மூடி, மீண்டும் சரிபார்க்கவும்.',
      checkedAt: (at) => (at ? `கடைசியாக சரிபார்க்கப்பட்டது ${new Date(at).toLocaleTimeString()}` : 'இன்னும் சரிபார்க்கப்படவில்லை'),
      verdict: { green: 'தயார்', amber: 'அம்பர்', review: 'மறுஆய்வு', block: 'தடுக்கப்பட்டது' },
      level: { block: 'தடுக்கப்பட்டது', review: 'மறுஆய்வு', amber: 'அம்பர்', info: 'தகவல்' },
    },
    questionLangNote: 'கேள்வி ஆங்கிலத்தில் காட்டப்படுகிறது; தமிழில் கேள்வி இன்னும் கிடைக்கவில்லை.',
  },
};
