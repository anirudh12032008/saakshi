import type { State } from '@saakshi/core/protocol';
import type { Lang } from '../../shared/ipc.ts';
import type { Tick } from './exam-state.ts';

export interface Strings {
  title: string; candidate: string; form: string; start: string; startNote: string; question: string;
  timeLeft: string; timeUp: string; lang: string; palette: string; saveNext: string; markNext: string; clear: string;
  saved: string; online: string; offline: string; faces: string; cameraOff: string;
  state: Record<State, string>; tick: Record<Tick, string>;
}

export const T: Record<Lang, Strings> = {
  en: {
    title: 'Saakshi exam', candidate: 'Candidate', form: 'Form', start: 'Start exam',
    startNote: 'Each answer is saved on this computer first, then at the centre server, then at the exam server. The ticks next to each question show how far it has reached.',
    question: 'Question', timeLeft: 'Time left', timeUp: 'Time is up. Please wait for the invigilator.', lang: 'Language',
    palette: 'Question palette', saveNext: 'Save & Next', markNext: 'Mark for Review & Next', clear: 'Clear Response',
    saved: 'Saved', online: 'Connected', offline: 'Offline — your answers are safe on this computer', faces: 'Faces', cameraOff: 'Camera unavailable',
    state: { NV: 'Not visited', NA: 'Not answered', A: 'Answered', MR: 'Marked for review', AMR: 'Answered and marked for review (will be evaluated)' },
    tick: { none: '', local: 'saved on this computer', relay: 'saved at the centre server', cell: 'saved at the exam server' },
  },
  hi: {
    title: 'साक्षी परीक्षा', candidate: 'अभ्यर्थी', form: 'प्रश्न-पत्र', start: 'परीक्षा शुरू करें',
    startNote: 'हर उत्तर पहले इस कंप्यूटर पर, फिर केंद्र सर्वर पर और फिर परीक्षा सर्वर पर सहेजा जाता है। हर प्रश्न के पास के टिक बताते हैं कि उत्तर कहाँ तक पहुँचा है।',
    question: 'प्रश्न', timeLeft: 'शेष समय', timeUp: 'समय समाप्त। कृपया निरीक्षक की प्रतीक्षा करें।', lang: 'भाषा',
    palette: 'प्रश्न पैलेट', saveNext: 'सहेजें और आगे बढ़ें', markNext: 'समीक्षा हेतु चिह्नित करें और आगे बढ़ें', clear: 'उत्तर मिटाएँ',
    saved: 'सहेजा गया', online: 'जुड़ा हुआ', offline: 'ऑफ़लाइन — आपके उत्तर इस कंप्यूटर पर सुरक्षित हैं', faces: 'चेहरे', cameraOff: 'कैमरा उपलब्ध नहीं',
    state: { NV: 'नहीं देखा', NA: 'उत्तर नहीं दिया', A: 'उत्तर दिया', MR: 'समीक्षा हेतु चिह्नित', AMR: 'उत्तर दिया और समीक्षा हेतु चिह्नित (मूल्यांकन होगा)' },
    tick: { none: '', local: 'इस कंप्यूटर पर सहेजा गया', relay: 'केंद्र सर्वर पर सहेजा गया', cell: 'परीक्षा सर्वर पर सहेजा गया' },
  },
};
