# Research sweeps (2026-09-27)

Raw output of the 4 planning research agents: landscape, India incidents/policy, tech feasibility, psychometrics. Re-verify every figure against its primary source before it goes in the deck.

### Research: landscape
# Landscape of large-scale CBT and secure-exam systems: resilience, security, gaps (as of 27 Sep 2026)

## Why this matters now (India, 2025–26)
- **NEET-UG 2026** was a pen-and-paper exam taken by about 22.7 lakh candidates on 3 May. It was cancelled on 12 May after a leak and re-held on 21 June. The CBI arrested a school headmistress whom NTA had appointed as a subject expert. The leak came from someone who set the paper, not from the delivery chain. The government announced NEET will move to CBT from 2027, and the Education Minister resigned on 25 July [1][2].
- **Policy is still being decided.** A task force led by Nandan Nilekani (with S. Somanath and V. Kamakoti) was set up with a "leak-proof, tamper-resistant, DPI" mandate; its call for public suggestions closed 13 Sep 2026. The Public Examinations Amendment Bill 2026 raises penalties. Proposed technical measures include encrypted question papers sent just in time over NKN with **two-key decryption**, IRT-randomised papers and air-gapped intranets. On 19 Aug 2026 the Supreme Court asked NTA to report how far it has implemented the Radhakrishnan recommendations [3][4][5].
- **CUET-UG 2026:** a glitch "at TCS's end" delayed Shift 1. Candidates got "full compensatory time", 3,765 who had left got a one-time re-test, and TCS iON was asked for a root-cause analysis [6].
- **SSC 2025 (vendor Eduquity):** Phase 13 and CGL shifts were cancelled over software crashes and biometric failures. At a Dhanbad centre the **server manager** was arrested; candidates "moved the mouse" while answers were auto-selected, and SSC confirmed "remote access attempts". A Bihar CHO CBT was cancelled over a proxy server and remote-view software; 37 people were arrested, including the centre head and the IT manager [7][8][9].
- **JEE Main 2025:** one candidate's submission pop-up showed 46 attempted, but the published response sheet showed 29. The Delhi HC gave interim relief. NTA's challenge window covers the answer key, **not the recorded responses** [10].

## Existing systems

**College Board Bluebook (digital SAT/AP)**
- How it works:
  - A pre-test device check covers OS, memory, disk space and blocking settings.
  - Exam setup is done 5 days before the test.
  - Answers are **saved on the device**, so a candidate keeps testing through internet drops. Internet is needed only at check-in and at submission.
  - If a candidate is offline at time-up, they have until 11:59 pm the next day to submit, and **only from the same device**. Swapping devices can lose the answers.
  - When the connection is down, proctors lose the Test Day Toolkit and have to watch students in person [11][12][13].
- Failures:
  - **March 2025:** a misconfigured *security setting* auto-submitted tests early for 8,855 international candidates (12.8%) and 1,231 domestic ones. Restart instructions cost others time. College Board gave refunds, a free voucher, early score preview with keep-or-cancel, and a makeup date [14].
  - **2026:** an AWS outage on 5 Mar, a Text-to-Speech outage for AP on 4 May, and a macOS/iOS calculator crash on 9 Sep (workaround: restart the app) [15].
- Lesson: a security check that fails hard is itself an outage.

**TCS iON (NTA, SSC, banking)**
- How it works:
  - Every centre runs an **Assessment Examination Center (AEC)** server locally, with no internet exposure. It is split into "drives" and syncs to a central data centre.
  - An offline mode moves data on external media.
  - The paper stays encrypted until the first candidate starts. The exam runs on a LAN with randomised items and seats, biometrics and CCTV.
  - TCS says it detects 20+ cheating patterns [16][17].
- Weakness: the **centre server and its operator are fully trusted**, so the SSC and Bihar cases are insider attacks. Candidates get no evidence of their recorded responses beyond a PDF.

**Safe Exam Browser (open source)**
- How it works: a kiosk lockdown browser. The Config Key and Browser Exam Key are hashes of the settings, and the LMS verifies them. It detects virtual machines, and SEB Server adds monitoring [18][19].
- Failures:
  - Several public GitHub patches bypass the VM check [20].
  - Platforms often never check the key.
  - A USENIX Security 2022 study found that the anti-cheat measures in four proctoring suites "can be trivially bypassed" [21].

**Respondus LockDown Browser + Monitor**
- How it works: a lockdown browser plus AI flags from the webcam.
- Failures:
  - False positives from poor lighting, looking down at rough work, or family members walking into view [22].
  - A **$6.25M settlement** under Illinois' biometric privacy law (BIPA) [23].

**Proctorio, ProctorU (now Meazure Learning), Examity**
- Proctorio and Respondus say they use face *detection*, not face recognition. Proctorio's lawsuit against a critic ended in Nov 2025 without any of its claims proven [24].
- A US federal court ruled mandatory room scans unconstitutional (*Ogletree*, 2022) [25].
- ProctorU **dropped AI-only proctoring** because only about 10% of faculty ever watched the flagged video [26].
- ProctorU and Examity both faced biometric-privacy suits, ProctorU's after a data breach [27].

**Pearson VUE OnVUE**
- How it works: a system test beforehand; ID photos and a 360° room scan checked by a human "greeter" (photos deleted afterwards); then a live proctor watches video and audio [28].
- Failures:
  - A global outage on 3 Sep 2025, after which candidates had to reschedule through customer support [29].
  - Paid services now sell invisible AI overlays for Mac.
  - Tools like **Cluely** set the operating system's screen-capture-exclusion flag, so they never appear in recordings or screen shares. The tools that can detect them read the process list [30][31].

**Duolingo English Test**
- How it works: the session is recorded, then reviewed by AI and then by **a human for every session**, against 75+ behaviours. The test is adaptive, and DET also scans the web for leaked items [32].
- Failures: only one appeal is allowed, within 72 hours, and **results that could not be certified for technical reasons cannot be appealed** at all [33].

**Research without deployment**
- Cryptographic "verifiable exam" protocols such as Remark! (formally proved with ProVerif) already exist. No production CBT uses them [34].

## Gaps no system handles well
1. **Candidates cannot verify their own responses.** No platform gives a receipt the candidate can check. JEE Main 2025 ended in court because it was the candidate's word against the vendor's PDF.
2. **Insiders are trusted.** Centre servers and staff can change or inject responses, and nothing is signed at the point the candidate answers.
3. **Offline resilience is tied to one device.** Bluebook keeps answers on the local disk, so if the device dies the candidate is stuck. No platform offers resume on any seat with integrity checks.
4. **Re-exam decisions are made ad hoc.** CUET 2026, SSC 2025 and Bluebook 2025 each improvised compensatory time, re-tests or keep-or-cancel options. None used a published quantitative rule.
5. **Integrity checks either fail hard or fail open.** Bluebook's security setting auto-submitted tests; SEB's checks are easy to bypass. None degrade gracefully.
6. **AI flags are opaque and hard to contest.** There are false positives, biometric lawsuits, AI-only flags nobody reviews, and technical failures that cannot be appealed. There is little DPDP-style data minimisation.
7. **Leaks at the paper-setter level go undetected.** Securing delivery would not have stopped NEET 2026. Multi-shift exams (a Radhakrishnan recommendation [5]) also expose the same items across shifts, and nobody monitors item exposure publicly.
8. **Nobody detects invisible AI overlays** (capture-excluded windows) or remote-access tools on both macOS and Windows.

## Opportunities to differentiate
1. **A response sheet the candidate can prove.**
   - Journal on the client: append-only, hash-chained, Ed25519-signed.
   - Signed receipt at submission, with Merkle inclusion against a published root.
   - Demo: edit one row in Postgres; verification fails and the candidate's receipt exposes it. Pitch it as the answer to the JEE Main 2025 case.
2. **Security checks that never cause an outage.**
   - *Before* the exam: hard gates for VMs, remote-desktop tools (AnyDesk and similar), and windows marked capture-excluded (macOS window sharing state; Windows display affinity).
   - *During* the exam: flag the machine and move the candidate to another seat. Never auto-submit or lock out.
   - This changes the team's idea of marking the machine "ineligible" mid-exam, and it is the direct lesson from Bluebook's March 2025 failure.
3. **Resume on any seat.**
   - The journal is replicated to the centre node, so a candidate can move to another machine and continue.
   - Compensatory time is calculated from gaps in signed heartbeats.
   - This goes further than Bluebook's same-device rule.
4. **Two-key, time-locked paper plus per-candidate equivalent forms.**
   - Two-key release matches the task force's direction.
   - Drawing each candidate's paper from a large item bank limits what any one setter can leak, which addresses NEET 2026-style leaks.
5. **Disruption decision engine.**
   - Inputs: event logs, minutes lost per candidate, and score comparisons between affected and unaffected candidates.
   - Output: a recommendation to compensate, re-test a subset, or re-conduct, following a published rule and with an audit report.
6. **Leak radar.**
   - Items whose difficulty suddenly drops in later shifts or particular centres.
   - Candidates answering hard items unusually fast.
   - Identical wrong answers clustered at one centre.
   - This covers insider remote-control patterns too (for example, answers arriving with no matching UI input events).
7. **Flags that are explainable and privacy-minimal.**
   - Detection runs on the device; only the flag and a short evidence clip are uploaded.
   - A human must review every flag, and the candidate has a window to contest it.
   - Retention follows DPDP.
   - This is the stated lesson from ProctorU and the BIPA settlements.
8. **Framing for judges.** Position the whole system as "trust infrastructure" for NTA's CBT move in 2027, aligned with the Nilekani task-force mandate. Performance baselines across exams would need opt-in consent under DPDP.

## Sources
[1] https://en.wikipedia.org/wiki/2026_NEET_controversy
[2] https://www.outlookindia.com/national/dharmendra-pradhan-resigns-over-neet-ug-2026-paper-leak-who-will-be-indias-next-education-minister
[3] https://www.drishtiias.com/daily-updates/daily-news-analysis/public-examinations-amendment-bill-2026-and-nandan-nilekani-led-task-force-on-exam-reforms
[4] https://www.etvbharat.com/en/bharat/neet-sc-directs-nta-to-inform-on-steps-taken-to-implement-recommendations-of-radhakrishnan-panel-enn26081902733
[5] https://vajiramandravi.com/current-affairs/k-radhakrishnan-committee-blueprint-for-secure-and-transparent-exam-reform-in-india/
[6] https://www.business-standard.com/education/news/cuet-ug-nta-to-hold-re-test-for-over-3-700-students-after-glitch-126053001280_1.html
[7] https://news.careers360.com/ssc-phase-13-exam-2025-cancelled-at-multiple-centres-due-technical-administrative-glitches
[8] https://news.careers360.com/ssc-cgl-2025-dhanbad-server-manager-arrested-cheating-case-scam-gang-candidates-mouse-answers-vendor-chairman-supreme-court/amp
[9] https://www.newsonair.gov.in/bihar-cho-exam-cancelled-amidst-paper-leak-allegations
[10] https://news.careers360.com/jee-main-2025-result-errors-response-sheet-blank-delhi-high-court-student-jee-advanced-seeks-nta-explanation/amp
[11] https://bluebook.collegeboard.org/help-center/what-happens-if-students-lose-their-internet-connection
[12] https://bluebook.collegeboard.org/help-center/what-if-theres-connectivity-issue-after-testing-starts
[13] https://bluebook.collegeboard.org/technology/digital-readiness-check
[14] https://newsroom.collegeboard.org/what-happened-march-8-9-weekend-sat-and-what-college-board-doing-about-it
[15] https://bluebook.collegeboard.org/alerts
[16] https://digialm.com/dotcom/iONHelp/Assessment%20Solution/SolutionOverview/Assessment%20Examination%20Center.html
[17] https://tcsionblog.wordpress.com/2019/08/14/jee-main-2019-how-does-nta-secure-the-exam/
[18] https://safeexambrowser.org/developer/seb-config-key.html
[19] https://safeexambrowser.org/windows/win_usermanual_en.html
[20] https://github.com/tynkering/seb-patch
[21] https://arxiv.org/abs/2205.03009
[22] https://staffsupport.spcollege.edu/hc/en-us/articles/27412844781851-Enhanced-Flagging-for-Respondus-Monitor
[23] https://topclassactions.com/lawsuit-settlements/closed-settlements/respondus-online-exam-bipa-6-25m-class-action-lawsuit-settlement/
[24] https://ubyssey.ca/news/proctorio-lawsuit-ends/
[25] https://www.eff.org/deeplinks/2022/08/federal-judge-invasive-online-proctoring-room-scans-are-also-unconstitutional
[26] https://www.insidehighered.com/news/2021/05/24/proctoru-abandons-business-based-solely-ai
[27] https://lawstreetmedia.com/news/tech/students-sue-online-exam-proctoring-service-proctoru-for-biometrics-violations-following-data-breach/
[28] https://payroll.org/certification/onvue
[29] https://help.opengroup.org/hc/en-us/articles/29198713847186-Pearson-VUE-Outage-3-Sep-2025-Now-Resolved
[30] https://aiseptor.com/detect-cluely
[31] https://www.schoolyear.com/blog/cluely
[32] https://blog.duolingo.com/testsecurity/
[33] https://testcenter.zendesk.com/hc/en-us/articles/360058579151-Can-test-takers-appeal-their-results
[34] https://link.springer.com/chapter/10.1007/978-3-319-12400-1_5

### Research: india
# India exam disruptions and policy context, 2019–2026: citable figures for the pitch deck

**Legend:** [V] means two or more sources agree. [?] means one secondary source or a figure that conflicts with another; check it before putting it on a slide.

## Headline for slide 1: the 2026 crisis is live and recent

- **NEET-UG 2026 was cancelled.** The exam was held 3 May 2026 and cancelled 12 May for about 22.79 lakh registered candidates. The re-exam was held 21 June 2026 in pen-and-paper mode, at no fee, across 551 Indian and 14 overseas cities, and about 20 lakh appeared [V]. ([Outlook](https://www.outlookindia.com/national/neet-ug-2026-exam-cancelled-re-exam-scheduled-for-june-21-by-nta), [Wikipedia](https://en.wikipedia.org/wiki/2026_NEET_controversy))
  - **How it leaked.** A "guess paper" of about 410 questions contained about 120 that matched the real paper. It circulated about 45 hours before the exam. The CBI traced it to insiders at the Nashik printing press who scanned papers between printing and dispatch. It then spread through Haryana and Rajasthan (Sikar, Jaipur) to more than 10 states [V on the question counts; ? on the exact origin, because Wikipedia also names an NTA translator]. ([Gulf News](https://gulfnews.com/world/asia/india/inside-the-neet-leak-nashik-student-whatsapp-trails-45-hour-head-start-1.500539003), [SCC Online](https://www.scconline.com/blog/post/2026/05/15/neet-2026-paper-leak-examination-incident-explained/))
  - **Human cost.** At least 11 aspirants died by suicide in the 46 days between cancellation and re-test, according to Hindustan Times as cited by Gulf News [?]. Handle this sensitively in the deck.
  - **Political fallout.** Education Minister Dharmendra Pradhan resigned on 25 July 2026. On 26 July the PM set up a six-member **Nilekani Task Force** (members include S. Somanath, V. Kamakoti and Tapan Deka) to "future-proof the NTA". The Supreme Court has asked for progress affidavits. ([Outlook explainer](https://www.outlookindia.com/national/outlook-explains-from-radhakrishnan-to-nilekani-why-india-is-revisiting-neet-reforms), [LiveLaw](https://www.livelaw.in/top-stories/supreme-court-neet-ug-paper-leak-visit-nta-office-nilekani-committee-reforms-550673))
  - **NEET moves to computer-based testing (CBT) from 2027.** This was announced 15 May 2026 and reconfirmed by the NTA Director General on 14 Sep 2026. NTA has asked AICTE to identify government colleges to act as "Standard Testing Centres" [V]. ([MedicalDialogues](https://medicaldialogues.in/news/education/medical-admissions/neet-2027-to-shift-to-computer-based-test-nta-asks-aicte-to-identify-exam-centres-178572)) **This is the strongest "why now" for the pitch: about 22 lakh candidates are about to go through exactly the kind of CBT pipeline this prototype hardens.**
- **CUET-UG 2026 glitch, 30–31 May 2026.** A TCS iON fault delayed the morning shift by about 2 hours. About 95% of candidates finished after compensatory time. 3,765 candidates who had already been biometrically checked in left before the restart and got a one-time re-test on 6–7 June. NTA ordered a root-cause analysis [V]. ([Tribune](https://www.tribuneindia.com/news/top-headlines/cuet-ug-delayed-at-some-centres-due-to-technical-glitch-afternoon-timing-revised/), [Business Standard](https://www.business-standard.com/education/news/cuet-ug-exam-affected-by-glitch-to-be-reheld-on-june-6-7-nta-126060201464_1.html)) **This maps directly onto resume-on-any-seat, compensatory time and live candidate status.**

## 2024: the year of cascading failures

| Incident | Scale | What happened |
|---|---|---|
| NEET-UG 2024 (5 May) | 24.06 lakh registered, 23.33 lakh appeared [V] | 1,563 candidates got grace marks for lost time. The marks were scrapped, a re-test was offered, and **only 813 took it** [V]. There were 67 perfect scores at first; after a physics answer-key correction and the grace-mark rollback this fell to 17 [V]. The Supreme Court (verdict 23 July, reasons 2 Aug 2024) refused a re-test and called the leak localised, with about 155 beneficiaries at Hazaribagh and Patna [V]. The Court recorded failures: wrong question-paper sets (Canara Bank vs SBI) sent to centres, papers moved by e-rickshaw, private couriers, weak CCTV. ([SCC Online](https://www.scconline.com/blog/post/2024/08/08/explained-final-verdict-of-supreme-court-on-neet-ug-2024/), [PW](https://www.pw.live/neet/exams/neet-2024-topper-list)) |
| UGC-NET June 2024 | about 9 lakh candidates | Held 18 June in OMR mode and cancelled the **next day** after an I4C alert that the paper was on the darknet. The CBI took the case. It was re-held 21 Aug–4 Sep, 2024 in CBT mode; one day was then lost to flooding and moved to 5 Sep. ([Careers360](https://news.careers360.com/ugc-net-june-2024-cancelled-nta-integrity-of-exam-may-be-compromised-education-ministry)) |
| CSIR-UGC-NET (25–27 June 2024) | about 2 lakh [? size not verified] | Postponed for "logistic issues". ([Scroll](https://scroll.in/announcements/1069639/csir-ugc-net-june-2024-postponed-check-details-here)) |
| NEET-PG (23 June 2024) | about 2 lakh [?] | Postponed **about 12 hours before the start** "as a precautionary measure". ([Tribune](https://www.tribuneindia.com/news/india/neet-pg-2024-scheduled-for-june-23-postponed-as-precautionary-measure-fresh-date-soon-633168)) |
| CUET-UG 2024 | 13.48 lakh | Re-test on 19 July for about 1,000 candidates across 6 states; causes included question papers in the wrong language. Results slipped to 28 July and delayed admissions. ([Legal Chariot/PTI](https://www.legalchariot.com/2024/07/cuet-ug-2024-results-by-july-22-retest-for-nearly-1000-students-on-july-19.html)) |
| UP Police Constable (17–18 Feb 2024) | **48 lakh** candidates, 60,244 posts, 2,385 centres | Cancelled over a leak and re-held 23–31 Aug 2024 [V]. ([BusinessToday](https://www.businesstoday.in/india/story/up-police-constable-exam-2024-rescheduled-due-to-paper-leak-cm-yogi-adityanath-418824-2024-02-24)) |
| Bihar TRE-3 (15 Mar 2024) | about 3.75 lakh, 415 centres | Paper leaked **before barcoding and printing**. 266 arrests. Re-held 19–22 July. ([Careers360](https://news.careers360.com/bpsc-tre-30-exam-cancelled-due-paper-leak-re-exam-dates-announced-soon-latest-news/amp)) |

## 2025: CBT operations fail at scale

- **SSC Selection Post Phase 13 (24 Jul–1 Aug 2025).** Server crashes, login failures, questions that would not load, power cuts, and centres cancelled hours before start. This led to the "Chalo Delhi" protests. A re-exam for **59,500** candidates was identified by **analysing server logs**. ([Shiksha](https://www.shiksha.com/news/sarkari-exams-ssc-phase-13-exam-2025-rescheduled-ssc-announces-re-exam-for-59-500-candidates-on-august-29-blogId-208554), [PW](https://www.pw.live/ssc/exams/ssc-protest-2025-explained-wrong-centres-technical-glitches-exam-cancellation)) **This is the pitch's argument for log-driven identification of affected candidates.**
- **SSC CGL 2025.** 28 lakh registered. It was postponed from August to September after the vendor change (new vendor reported as Eduquity [?]). Centres in Delhi, Gurugram, Mumbai, Jammu and elsewhere were then cancelled on 12 Sep and rescheduled. ([Logical Indian](https://thelogicalindian.com/ssc-postpones-cgl-2025-to-september-after-technical-glitches-28-lakh-candidates-impacted/), [Careers360](https://news.careers360.com/ssc-cgl-2025-exams-cancelled-multiple-centres-protests-glitch-free-promise-failed-delhi-gurugram-jammu-jharkhand-west-bengal/amp))
- **JEE Main 2025 Session 1.** A record 12 questions were dropped for errors, an error rate of about 1.6% against a 0.6% threshold. ([ThePrint](https://theprint.in/india/education/nta-under-fire-once-again-after-a-record-12-questions-dropped-in-jee-main-2025-what-went-wrong/2494480/))
- **Rajasthan SI 2021 (859 posts).** The High Court cancelled the recruitment on 28 Aug 2025 over leaks on WhatsApp, "Bluetooth gangs" and dummy candidates. A division bench stayed that order on 8 Sep 2025, so the case is still unresolved. ([ANI](https://aninews.in/news/national/general-news/rajasthan-high-court-cancels-2021-si-recruitment-over-paper-leak-allegations20250828163025/))

## Systemic stat for a problem slide

An Indian Express investigation counted **41 documented leaks in 5 years across 15 states**, affecting about **1.4 crore applicants** competing for about 1.04 lakh posts [V: Express, cited by several outlets; the date window is roughly 2019–2024]. Rajasthan had 14 leaks between 2015 and 2023. ([Wikipedia list](https://en.wikipedia.org/wiki/List_of_paper_leaks_in_India))

## Policy context

- **Public Examinations (Prevention of Unfair Means) Act 2024.** Assent 12 Feb 2024, in force 21 June 2024. Unfair means carries 3–5 years and a fine up to ₹10 lakh. Organised crime carries 5–10 years and a fine of at least ₹1 crore. It covers UPSC, SSC, RRB, IBPS, NTA and central ministries. ([PRS](https://prsindia.org/billtrack/the-public-examinations-prevention-of-unfair-means-bill-2024))
- **Amendment Bill 2026.** Passed by both Houses after NEET 2026. The individual penalty rises to 5–10 years and a fine up to ₹50 lakh. It creates statutory fast-track courts and deadlines of **2 months to investigate and 3 months to try** a case [V on these]. Higher organised-crime fines of ₹5–10 crore were reported by one source only [?]. ([Upstox](https://upstox.com/news/business-news/latest-updates/explained-longer-jail-term-bigger-fines-fast-track-courts-what-s-in-anti-paper-leak-bill/article-197617/), [Vajiram](https://vajiramandravi.com/current-affairs/public-examination-bill-2026/)) **Pitch angle: a 5-month prosecution window needs court-grade tamper-evident logs and audit trails, which this prototype produces.**
- **Radhakrishnan High-Level Committee.** Report submitted Oct 2024. It made **101 recommendations** and drew on 37,000+ MyGov responses. The concrete ones:
  - Computer-assisted pen-and-paper testing: the encrypted paper is sent electronically and printed at the centre just before the exam.
  - A "Digi-Exam" identity system modelled on Digi Yatra: Aadhaar, biometrics and AI analytics at application, exam and admission.
  - Multi-session exams with documented score normalisation, multi-stage NEET, and computer-adaptive testing in the long run.
  - 400–500 government CBT centres (KVs, JNVs, universities) giving about 2–2.5 lakh seats per session within about a year, eventually one per district; 1,000 or more secure centres in the long term.
  - Mobile testing buses of about 150 seats each.
  - Restructure NTA into 10 verticals, including Information Security and Vigilance & Forensics, and reduce outsourcing.
  - Multilingual AI grievance chatbots.
  - **Implemented:** NTA has run only entrance exams, not recruitment, since 2025.
  - ([Vajiram](https://vajiramandravi.com/current-affairs/k-radhakrishnan-committee-blueprint-for-secure-and-transparent-exam-reform-in-india/), [Careers360](https://news.careers360.com/nta-report-use-kv-jnv-neet-ug-jee-main-exam-centres-500-k-radhakrishnan-high-level-committee-national-testing-agency/amp), [Business Standard](https://www.business-standard.com/education/news/nta-to-conduct-only-higher-education-entrance-exams-from-2025-pradhan-124121700906_1.html))
  - **Pitch framing: "We implement Radhakrishnan recommendations #X, #Y, #Z as working software."**
- **DPDP Act 2023 and DPDP Rules 2025.**
  - The Rules were notified 13–14 Nov 2025 with phased effect. Core obligations (consent, security safeguards, breach reporting, retention and erasure) apply from about **May 2027**, which is the same cycle as NEET going CBT.
  - Anyone under 18 needs **verifiable parental consent**, and many NEET/CUET candidates are 17.
  - The Fourth Schedule exempts educational institutions from the parental-consent and tracking bans only where processing is for the child's interest or safety and is necessary and proportionate [? whether this covers an exam body such as NTA needs legal reading].
  - Biometric data is not a separate sensitive category in the Act, but minimisation still applies.
  - ([PIB](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190014), [Fourth Schedule](https://privacylawhub.com/bare-acts/dpdp-rules-2025/schedule-iv-fourth-schedule-exemptions-from-section-9-1-and-9-3-))
  - **This supports on-device face detection with only flags uploaded, and a retention timer.**
- **NEP 2020.** PARAKH is the national assessment centre. CBSE Class 10 has held two board exams since 2026, the first in February (mandatory) and the second in May (optional). Class 12 answer books have been marked on screen since 2026. The trend is toward more frequent, digitised assessment. ([BusinessToday](https://www.businesstoday.in/education/exams/story/cbse-2026-board-exams-heres-what-majorly-changes-for-class-10-and-class-12-students-under-nep-2020-515841-2026-02-12), [PARAKH](https://parakh.ncert.gov.in/about-examination-reforms))
- **APAAR / Academic Bank of Credits / DigiLocker.** As of 2 July 2026 there were **26.35 crore verified APAAR IDs**, about 16.62 crore of them in schools, and 6.73 crore or more mapped credit records. UGC required institutions to upload 2025 exam credits to NAD-ABC by 30 June 2026. ([PIB factsheet](https://www.pib.gov.in/FactsheetDetails.aspx?id=150693), [The Hawk](https://www.thehawk.in/news/science/2635-crore-verified-apaar-ids-generated-across-india)) **Recommendation for the team's "centralised record through the year" idea: key it to APAAR and issue signed receipts to DigiLocker rather than building a new registry.** Performance-baseline cheat scoring on minors needs a DPDP proportionality argument.

## Tier-2/3 infrastructure realities

- **UDISE+ 2024-25 (schools, often used as venues).**
  - Internet: 63.5% of schools overall, 58.6% of government schools, 77.1% of private schools.
  - Computers: 64.7% of schools.
  - Electricity: 93.6% have a connection, about 92% functional; about 94,000 schools have none, including about 32,600 in Uttar Pradesh.
  - ([EFA India](https://educationforallinindia.com/63-percent-of-indian-schools-now-online-yet-over-25000-languish-without-electricity/), [Insights](https://www.insightsonindia.com/2025/09/02/udise-2024-25-report/))
- **Power hours.** Average supply is 22.6 hours a day in rural areas and 23.4 hours in urban areas (2025). That leaves roughly 1.4 hours a day without power in rural areas, which is enough to interrupt a 3-hour exam. ([PIB](https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=2105394))
- **Named failure modes.** SSC 2025 incident reports cite "poor connectivity" and "power cuts".
- **CBT capacity gap.** NEET needs about 22 lakh seats against the 2–2.5 lakh seats per session that Radhakrishnan projected. That means multi-shift exams, and so normalisation and fairness evidence become core requirements.

**What this means for the design:** assume the WAN link at centres will fail. The offline-first journal, a local centre server, a time-locked paper key and UPS-aware resume all follow directly from the numbers above.

## Figures to verify before the deck

- CSIR-NET and NEET-PG 2024 candidate counts.
- The SSC CGL 2025 vendor name.
- The Wikipedia claims "12 suicides" and "110,000 qualified". The second is almost certainly wrong, so don't use it.
- The organised-crime penalties in the 2026 amendment.
- Whether the DPDP Fourth Schedule exemption covers an exam body.
- No public figure was found for what the NEET 2026 re-exam cost. If a slide needs one, label it as an estimate. Fee refunds alone would come to roughly ₹300–380 crore, assuming refunds were issued, which is unconfirmed.

### Research: tech
# Feasibility of the cross-platform secure exam client and backend (as of Sep 2026)

**Bottom line:** the plan is feasible in 1–2 weeks if the team uses **Tauri 2.11.x plus Axum/Postgres in one shared Rust workspace**. The lockdown should aim to "prevent what is cheap, detect and log everything else" rather than promise full prevention. Neither OS lets you lock a machine down completely from user space without drivers or MDM.

## (1) Tauri 2 vs Electron for lockdown

**macOS (both frameworks need the same native code):**
- Kiosk comes from `NSApplication.setPresentationOptions`, called through `objc2-app-kit` on the main thread.
- Useful flags: `HideDock`, `HideMenuBar`, `DisableProcessSwitching` (turns off Cmd-Tab and Exposé), `DisableForceQuit`, `DisableSessionTermination`, `DisableHideApplication`. This is what Safe Exam Browser uses. Invalid flag combinations throw an exception. ([Apple kiosk note](https://developer.apple.com/library/archive/technotes/KioskMode/Introduction/Introduction.html), [SEB mac](https://safeexambrowser.org/macosx/mac_usermanual_en.html))
- Electron's `kiosk:true` still lets Cmd-Tab through ([electron#18207](https://github.com/electron/electron/issues/18207)).

**Windows:**
- Use `SetWindowsHookExW(WH_KEYBOARD_LL)` from the `windows` crate, on a thread with its own message loop. It can swallow the Win key, Alt-Tab, Alt-Esc and Ctrl-Esc.
- **Ctrl-Alt-Del and Win+L cannot be blocked.**
- One Tauri 2 kiosk project documents these hooks as unreliable and relies on Assigned Access instead ([ptrkhh/kiosk-browser](https://github.com/ptrkhh/kiosk-browser)).
- SEB's stronger modes ("new desktop", "disable Explorer shell") are too risky to build in this window.
- **Plan:** fullscreen, always-on-top, `set_closable(false)`, block the close request, and log focus-loss or blur as an integrity event.

**Screen-capture prevention:**
- **Windows:** `WDA_EXCLUDEFROMCAPTURE` works from user space, which is what `setContentProtected(true)` sets. It does not stop someone photographing the screen.
- **macOS 15+:** ScreenCaptureKit **ignores** `sharingType = .none`. Apple's engineers say there is no public API to prevent capture. Tracked as [tauri#14200](https://github.com/tauri-apps/tauri/issues/14200) (open, upstream) and in [Apple forum 792152](https://developer.apple.com/forums/thread/792152). The flag still blocks legacy CoreGraphics capture only.

**Verdict:** choose Tauri. The native code is needed either way, and Rust lets the client share the journal crate with the server. Electron's one real advantage is that Chromium behaves the same on both OSes.

## (2) Processes, blocklist and screen-sharing

- **Process list:** `sysinfo`, with the exact version pinned, because its API changes between minor versions. Current calls are `refresh_processes(ProcessesToUpdate::All, true)`, and `name()` returns an `OsStr`. On macOS, also match bundle IDs from `NSWorkspace.runningApplications`.
- **Blocklist:** a server-signed JSON with per-OS executable names, bundle IDs and a severity for each (block the start, or just flag). Process names can be renamed, so treat matches as a heuristic.
- **Remote sessions:** on Windows, `GetSystemMetrics(SM_REMOTESESSION)` plus `WTSQuerySessionInformation`. RemoteFX can hide RDP from this check, and TeamViewer/AnyDesk never show up as remote sessions, so you need process names for those ([MS docs](https://learn.microsoft.com/en-us/windows/win32/termserv/detecting-the-terminal-services-environment)). On macOS, look for the `screensharingd` process.
- **Detecting an active screen share:** macOS has no API that says "another app is capturing now."
- **Addition worth building (anti-overlay):** cheating overlays hide themselves from capture, and you can detect that.
  - Windows: `EnumWindows` plus `GetWindowDisplayAffinity`, which works on windows "from any process" ([MS](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowdisplayaffinity)). A non-zero affinity on another app's window is a flag.
  - macOS: `CGWindowListCopyWindowInfo` and look for `kCGWindowSharingState == 0` on other processes' windows.

## (3) VM detection and multiple displays

**macOS:**
- `sysctlbyname("kern.hv_vmm_present")` returns 1 under VMware, QEMU, Parallels and Virtualization.framework.
- `hw.model` is `VirtualMac2,1` in Apple's Virtualization.framework VMs; the `IOPlatformExpertDevice` manufacturer and model strings give the same signal.
- This is reliable against off-the-shelf VMs and can be spoofed by a determined attacker.

**Windows:**
- **Main pitfall:** the CPUID hypervisor bit is **set on bare-metal Windows 11 with VBS, Hyper-V or WSL2**. If the vendor is "Microsoft Hv", check the CreatePartitions privilege (CPUID 0x40000003, EBX bit 0); a root partition means real hardware ([detector notes](https://github.com/cvs0/windows-virtualization-detector)).
- Other signals: registry `HKLM\HARDWARE\DESCRIPTION\System\BIOS` `SystemManufacturer`/`SystemProductName` (the `winreg` crate is cheaper than WMI; the `wmi` crate for `Win32_ComputerSystem` is optional). MAC address prefixes: VMware 00:05:69, 00:0C:29 and 00:50:56; VirtualBox 08:00:27; Parallels 00:1C:42. The Hyper-V prefix 00:15:5D also appears on real hosts, so it gives false positives. CPUID crate: `raw-cpuid`.
- **Score the signals:** two or more independent signals mark the machine ineligible; one signal sends it to review.

**Multiple displays:** Tauri's `available_monitors()` and `currentMonitor`, re-checked periodically. Mirrored displays, HDMI splitters and capture dongles are invisible to software; only the camera can catch them.

## (4) Camera inside the webviews

**macOS (WKWebView):**
- Add `NSCameraUsageDescription` to `src-tauri/Info.plist`, and the `com.apple.security.device.camera` entitlement if the app is signed. Without the plist entry, macOS privacy controls (TCC) **kill the app** as soon as it asks for the camera.
- Open issues: [tauri#11951](https://github.com/tauri-apps/tauri/issues/11951) (prompt never appears) and [wry#1195](https://github.com/tauri-apps/wry/issues/1195) (double prompt on macOS 14).
- Camera grants are tied to the code signature, so an ad-hoc signed app gets re-prompted after every rebuild.

**Windows (WebView2):**
- WebView2 shows its own permission prompt. To auto-allow the camera, handle `PermissionRequested` through `with_webview` and `webview2-com`.
- If a user once clicks "Block", there is no re-prompt ([tauri#5042](https://github.com/tauri-apps/tauri/issues/5042)); you have to wipe the WebView2 profile.
- The Windows setting "Let desktop apps access your camera" must be on.

**Native capture fallback:** `nokhwa` (AVFoundation on macOS, Media Foundation on Windows). Maintenance is patchy (there is a fork), so use it only if getUserMedia fails.

## (5) On-device face detection

- **Use MediaPipe Tasks Vision (`@mediapipe/tasks-vision`) inside the webview:**
  - `FaceDetector` (BlazeFace short-range, about 230 KB) for counting faces.
  - `FaceLandmarker` with `outputFacialTransformationMatrixes` to get head yaw and pitch, which gives "looking away."
- **Setup:** copy `node_modules/.../wasm` and the `.task` model files into the app's own assets and call `FilesetResolver.forVisionTasks('/mediapipe/wasm')`. It then runs fully offline.
- **Settings:** force `delegate:'CPU'` on WKWebView, because GPU delegate errors (`kGpuService`) have been reported in webviews ([mediapipe#5348](https://github.com/google-ai-edge/mediapipe/issues/5348)). Sample 2–5 frames per second, not 30.
- **Avoid:**
  - face-api.js: unmaintained since 2020.
  - `ort` with YuNet: `ort` 2.0 is still a release candidate (rc.12), and you would have to pipe frames from the webview into Rust.

## (6) Encrypted journal

- **SQLite:** `rusqlite` with the `bundled` feature. Pragmas: WAL mode, `synchronous=FULL`, and on macOS **`fullfsync=ON`**, because a plain fsync there does not flush the drive cache. With `NORMAL`, a commit can be lost on power failure, though not on an app crash ([SQLite pragmas](https://www.sqlite.org/pragma.html)).
- **Encryption:** app-level `chacha20poly1305` (XChaCha, random 24-byte nonce per record). Use (exam, candidate, seq) as the associated data so a record cannot be moved to another position.
- **Skip SQLCipher:** it needs an OpenSSL build, which is painful on Windows and in CI.
- **Signing and hashing:** `ed25519-dalek` 2.x; `blake3` or `sha2` for the hash chain; `rs_merkle` for candidate receipts.
- **Canonical encoding:** hash fixed binary bytes (e.g. `postcard`), not JSON.
- **Server side:** upsert with `ON CONFLICT (candidate, seq) DO NOTHING`. The same seq arriving with a different hash raises a tamper alert.
- **Keys:** keep them in the OS keychain with `keyring` 3.x, pinned (features `apple-native` and `windows-native`). The crate family is being split into `keyring-core` plus store crates, so the API is moving.
- **Be honest about the limit:** the machine's owner can extract a key held on the device. Evidence of tampering comes from the **server countersigning the chain head on every sync**; only the unsynced tail is exposed.

## (7) Backend

**Recommendation:** Axum 0.8, sqlx 0.8 and tokio, in a Cargo workspace with an `exam-core` crate shared by the Tauri client and the server.

- A Bun + Hono backend (Bun has built-in SQL and WebSockets) iterates faster. But the journal would have to be verified byte-for-byte identically in two languages, and mismatches there are the most likely source of bugs.
- **Pitfalls for AI-written code:**
  - Axum 0.8 changed routes from `/:id` to `/{id}`; code written from older examples will use the old syntax.
  - sqlx's `query!` macros need `DATABASE_URL` at compile time. Either use the runtime `query_as` or commit the `cargo sqlx prepare` output.
- **Live dashboard:** Server-Sent Events via `axum::response::sse` fed by a `tokio::sync::broadcast` channel. Client heartbeats can be plain HTTP every 5–10 s, held in memory rather than written to Postgres.

**Cells without Docker:**
- Install Postgres with `brew install postgresql@17` or Postgres.app. Run `initdb` three times and start each on its own port (5433–5435) with `pg_ctl`; these are real independent failure domains.
- Run three processes of the same Axum binary (`CELL_ID`, `PORT` and `DATABASE_URL` from env), plus a small directory service that maps centre to cell and a standby cell.
- Use `mprocs` or `overmind` so you can kill a cell live on screen.
- Optional replica demo: `pg_basebackup -R`, then `pg_ctl promote`.
- Redis is not needed.

## (8) Builds and signing

**Windows build:**
- Cross-compiling from macOS (`cargo-xwin` plus NSIS) is experimental, and MSI installers can only be built on Windows ([Tauri docs](https://v2.tauri.app/distribute/windows-installer/)).
- Use a `tauri-apps/tauri-action` matrix (`macos-latest`, `windows-latest`) with `Swatinem/rust-cache`, and upload the NSIS artifact.
- **Test on a physical Windows laptop, not a Parallels VM.** Your own VM check will flag a VM.

**macOS signing:**
- Apple Silicon needs at least ad-hoc signing (`signingIdentity "-"`).
- A build made on the demo Mac itself carries no quarantine flag and just runs.
- A downloaded build is blocked. Sequoia removed the Ctrl-click bypass, so use System Settings → "Open Anyway", or `xattr -dr com.apple.quarantine`.

**Windows signing:** an unsigned installer shows SmartScreen's "More info → Run anyway." Install it before the demo.

Put proper signing in the report as the production path only (Developer ID notarization on macOS; Azure Trusted Signing on Windows, whose eligibility is limited).

## (9) Load testing

- **Tools:**
  - `oha`: single-endpoint RPS and latency histogram; its live terminal display looks good in the demo video.
  - `k6`: scripted scenario (login → fetch paper → answer saves → submit), including WebSockets.
  - `goose`: optional, if you want the load test in Rust.
- **Expected numbers:**
  - Axum with no database: 100k+ requests/s on an M-series laptop.
  - Durable Postgres writes are limited by WAL fsync and group commit. One published benchmark got about 1.9k multi-statement transactions/s on a Ryzen 7950X NVMe with 5 indexes ([dev.to](https://dev.to/haikasatryan/postgresql-write-performance-what-the-benchmarks-wont-tell-you-mm7)).
  - Simple single-row inserts over 32–64 connections: roughly low thousands to about 10k/s. This is my estimate, not a benchmark result, so **measure it**.
- **Batch journal sync** with `UNNEST`/`COPY` so rows per second is far higher than transactions per second.
- **Capacity maths (assumptions, not measurements):** about 0.02 answer events per second per candidate means a 100k-candidate cell needs about 2k writes/s, which one node handles. A shift of about 1M concurrent candidates then needs roughly 10 cells.

## Top 5 feasibility risks and mitigations

1. **macOS cannot fully prevent screen capture or lockdown escapes.** ScreenCaptureKit ignores `sharingType`, and there is no API to detect capture.
   - **Mitigation:** layered defence that produces evidence: presentation options, focus-loss events, blocklist, anti-overlay scan, camera.
   - **Framing:** high-stakes CBTs in India run on centre-managed PCs (MDM or Assigned Access), so position BYOD as a lower-stakes tier.
2. **Camera permissions differ between WKWebView and WebView2** (crash without plist, silent denial, blocked prompt that never returns).
   - **Mitigation:** day-1 spike on **bundled** builds on both OSes; auto-grant via `PermissionRequested`; pre-grant on the demo machines; an "invigilator attestation" fallback path.
3. **Slow Windows build and test loop.**
   - **Mitigation:** CI tauri-action from day 1 and a physical Windows laptop. Keep Windows-specific code under about 300 lines in `#[cfg(windows)]` modules: hook, WDA, BIOS registry, CPUID, affinity scan.
4. **VM-detection false positives** (VBS/Hyper-V CPUID bit, 00:15:5D prefix) and demoing on a VM.
   - **Mitigation:** score-based decision with the root-partition check. One signal flags for human review; two or more mark ineligible. Add a server-signed policy override for demos.
5. **Journal correctness and scope creep across the Rust client and server.**
   - **Mitigation:** one shared `exam-core` crate with a single check that flipping any byte makes verification fail and that replaying a sync is idempotent. Use fixed binary encoding.
   - Freeze the core demo path by day 7: offline answering → kill a cell → recover → verify receipt → decision report. Add LLM features last.

Sources: [tauri#14200](https://github.com/tauri-apps/tauri/issues/14200), [Apple DTS thread](https://developer.apple.com/forums/thread/792152), [SEB Windows manual](https://safeexambrowser.org/windows/win_usermanual_en.html), [kiosk-browser](https://github.com/ptrkhh/kiosk-browser), [electron#18207](https://github.com/electron/electron/issues/18207), [GetWindowDisplayAffinity](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowdisplayaffinity), [RDS detection](https://learn.microsoft.com/en-us/windows/win32/termserv/detecting-the-terminal-services-environment), [VM detector](https://github.com/cvs0/windows-virtualization-detector), [VirtualMac2,1](https://theapplewiki.com/wiki/VirtualMac2,1), [tauri#11951](https://github.com/tauri-apps/tauri/issues/11951), [wry#1195](https://github.com/tauri-apps/wry/issues/1195), [tauri#5042](https://github.com/tauri-apps/tauri/issues/5042), [MediaPipe web](https://developers.google.com/mediapipe/solutions/vision/face_landmarker/web_js), [mediapipe#5348](https://github.com/google-ai-edge/mediapipe/issues/5348), [ort](https://github.com/pykeio/ort), [SQLite pragma](https://www.sqlite.org/pragma.html), [keyring-rs](https://github.com/open-source-cooperative/keyring-rs), [Tauri Windows installer](https://v2.tauri.app/distribute/windows-installer/), [tauri-action](https://github.com/marketplace/actions/tauri-action), [Sequoia Gatekeeper](https://appleinsider.com/articles/24/08/06/apple-removes-control-click-option-for-skipping-gatekeeper-in-macos-sequoia), [Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/), [PG write benchmark](https://dev.to/haikasatryan/postgresql-write-performance-what-the-benchmarks-wont-tell-you-mm7), [Tauri releases](https://v2.tauri.app/release/).

### Research: psychometrics
**Psychometric forensics for CBT: research brief**

**Why this matters for the pitch.** In NEET-UG 2024 the Centre told the Supreme Court that IIT-Madras had analysed marks distribution and city- and centre-wise rank distribution and found no mass malpractice. That analysis supported the decision against a nationwide re-test ([BusinessToday](https://www.businesstoday.in/education/story/neet-ug-2024-results-paper-leak-controversy-supreme-court-centre-national-testing-agency-nta-iit-dy-chandrachud-436683-2024-07-11)). NEET-UG 2026 was held on 3 May 2026 and cancelled outright on 12 May, after a WhatsApp "guess paper" was found to match much of it. On 27 July 2026 a task force led by Nandan Nilekani was set up to recommend AI and blockchain tools for exam security ([Tribune](https://www.tribuneindia.com/news/india/nilekani-led-task-force-to-recommend-ai-blockchain-tools-to-prevent-paper-leaks/), [Wikipedia](https://en.wikipedia.org/wiki/2026_NEET_controversy)).

**Pitch line:** statistics that pin down which items, centres and shifts a leak reached, so the authority can re-conduct only the affected part of the exam.

Your client journal matters here. Signed, hash-chained per-item timestamps taken on the client leave out network lag, and that is what makes response-time evidence hold up.

### Methods

| # | Method | Input | Computation sketch | Catches | False-positive risks | MVP |
|---|---|---|---|---|---|---|
| 1 | Lognormal response-time (RT) model (van der Linden 2006) | Per-item dwell time t_ij | log t_ij = β_j − τ_i + ε, with ε ~ N(0, α_j⁻²). With complete data: β_j = the item's mean log-time, τ_i = mean(β_j − log t_ij), α_j = 1/SD(residual). Residual z_ij = α_j(log t_ij − β_j + τ_i). Person statistic l_t = Σz² ~ χ²_J (van der Linden & Guo 2008; Marianti et al. 2014) | Unusual speed patterns; the base for #2 and #6 | Language medium, disability (PwD) extra time, device lag | Low |
| 2 | Fast-correct answers on hard items (item pre-knowledge) | #1 plus correctness and IRT probability P_ij | Count items where P_ij < 0.5, the answer is correct and z_ij < −2. Expected count under honesty = Σ P_ij·Φ(−2). Poisson-binomial upper-tail p (a 10-line dynamic-programming loop). Formal versions: Sinharay 2017 (likelihood-ratio test on a suspect item set), Sinharay 2020, Zopluoglu 2026 (detects compromised items and examinees together) | Item pre-knowledge, answers relayed in real time | Strong, fast students (condition on θ and τ); badly calibrated items | Low–Med |
| 3 | Person-fit lz* and Guttman errors | Responses, IRT parameters | lz = (l₀ − E)/√Var. lz* corrects for estimated θ (Snijders 2001). G = number of (easy item wrong, hard item right) pairs; needs no IRT | Low scorers getting the hardest items right; random responding | Atypical curricula (state board vs CBSE), guessing; low power on short tests (Karabatsos 2003) | Low |
| 4 | Answer similarity: identical wrong answers, K-index (Holland 1996), ω (Wollack 1997), GBT (van der Linden & Sotaridona 2006), M4 (Maynes 2014) | Option chosen per item; room and seat | For each pair, match probability m_j = Σ_o P_i(o)·P_k(o), with option probabilities estimated empirically per score decile. Poisson-binomial tail p. Compare same-room pairs only. Gorney & Wollack (2025) add response times (the copier answers after the source) | Copying, answer relay, a shared crib | Popular wrong options (model how attractive each one is), candidates from the same coaching institute, high scorers (count wrong-answer matches) | Med |
| 5 | Collusion clustering (Wollack & Maynes 2017; Eckerly 2021) | p-values from #4 | Draw an edge when p < α/((N−1)/2). Take connected components or Louvain communities (networkx). On real licensure data, spectral clustering gave the best balance of detection and false alarms (Peng 2024) | Collusion rings, solver gangs | One false edge merging two groups; tune by simulation | Low once #4 exists |
| 6 | Item-compromise and centre radar: CUSUM (Veerkamp & Glas 2000; Choe, Zhang & Chang 2018) | Per item × shift × centre: observed minus expected correctness (expected uses θ from the other items), plus mean z_ij | S_t = max(0, S_{t−1} + x_t − k). Alarm threshold h set by simulating honest cohorts. Centre funnel plot at ±3 SE with empirical-Bayes shrinkage. Top-score spikes per centre tested against a binomial | Leaks spreading across shifts (JEE, CUET, SSC run many shifts); local leaks at a few centres | Small centres (use shrinkage); an item mistranslated in one language (that is DIF, not a leak); regional coaching patterns | Med |
| 7 | Candidate's own history (team idea) | Past scores and speeds | z-scores of change in accuracy and change in speed against the candidate's own record | Sudden jumps | See below | Low |

**Bonus signal (cheap):** late wrong-to-right answer changes from the journal. This is the digital version of erasure analysis (Wollack, Cohen & Eckerly 2015).

**Problems with the own-history baseline (#7):**
- **Real improvement gets flagged.** Coaching and ordinary learning both raise scores. The flag would hit students from disadvantaged backgrounds who improve, especially those with thin, noisy histories, which penalises upward mobility.
- **Cold start.** Most NEET and JEE candidates are sitting the exam for the first time and have no history.
- **The history doesn't compare cleanly.** Past tests used different forms that are not equated, and the history itself can be gamed.

**Better option:** compare the candidate against themselves *within the same exam*, on suspect items versus secure items (Sinharay 2017). Use history only as a prior that already expects some growth. Jacob & Levitt (2003) flagged only when unexpected gains and suspicious answer strings appeared together; use the same both-signals rule.

### Human review, false-positive control and fairness

- **Flags are evidence for review, never verdicts.** Statistical evidence can justify holding a score, a re-test or a hearing. It does not by itself prove misconduct (AERA/APA/NCME Standards 2014; ITC security guidelines; Cizek & Wollack 2017).
- **Base rates.** 20 lakh candidates tested at α = 0.001 still produce 2,000 innocent flags. To control this:
  - use very small per-test thresholds (≤1e-5 per candidate, and Bonferroni correction per examinee for pair tests);
  - apply Benjamini–Hochberg correction across items and centres;
  - escalate only when at least two independent signals agree (RT, similarity, proctoring or device logs).
- **Measure the false-positive rate.** Simulate honest cohorts to calibrate what "normal" looks like, then report the false-positive rate you actually got.
- **Fairness:**
  - normalise response times by language, accommodation and device;
  - audit flag rates by state, language, gender and category using a disparity ratio;
  - never use protected attributes as features.
- **Explainability.** Every flag shows the items involved, observed versus expected values, the p-value, an RT residual strip and a table of matching answers, with a plain-language reason. The candidate has a right to respond.
- **Policy fit.** Minimal data and a retention policy under the DPDP Act 2023 and Rules 2025. Human oversight and "understandable by design" from the [MeitY AI Governance Guidelines](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2228315) (Nov 2025).

### Recommended 3-signal MVP

Build it in Python with numpy, scipy and networkx. Expect roughly 400 lines, with no MCMC.

1. **Speed-accuracy pre-knowledge score** (methods 1 and 2), computed per candidate.
2. **Similarity and collusion graph** (methods 4 and 5): same-room Poisson-binomial test on identical wrong answers, then find rings.
3. **Leak radar** (method 6): item × shift × centre CUSUM plus the funnel plot, to locate compromised items and centres.

Together these cover the individual, the pair and the system. They are fast and explainable.

**How signals escalate:**
- One signal: watch.
- Two signals agree: goes to the review queue.
- Two signals plus proctoring or device evidence: escalate.

**Decision support.** When the radar has located the problem, recommend either re-scoring without the compromised items or re-conducting only at the affected centres. Leave lz* as an optional add-on.

### Synthetic demo data (seeded, with known answers)

**Base population**
- 20,000 candidates, 100 centres × 3 shifts, 3 languages, 100 four-option items per shift form (30 anchor items shared across shifts).
- θ ~ N(0,1) plus a centre effect ~ N(0, 0.3²). Speed τ is correlated with θ (ρ ≈ 0.3).
- 3PL items: a ~ LogN(0, 0.3), b ~ N(0,1), c = 0.2. Time parameters β_j ~ N(4, 0.4) (about 55 s per item), α_j ~ U(1.5, 2.5).
- Draw the popularity of each wrong option from Dirichlet(1). Realistic popular distractors put genuine pressure on the similarity index.

**Honest look-alikes (the system should not flag these)**
- Hindi-medium response times 10% longer.
- One item mistranslated in one language (DIF, not a leak).
- PwD candidates with 33% extra time.
- Rapid guessers near time-up (fast and *wrong*; Wise & Kong 2005).
- Genuine high flyers (θ = 3).
- Legitimate improvers.

**Planted cheating**
- **Leak:** 20 items leaked to 300 candidates at 3 centres in shift 2. They answer correctly with P = 0.95 and take about 12 s per item.
- **Rings:** 6 rings of 3–6 candidates in one room. Each copies the source's option with p = 0.7, 10–60 s after the source answers.
- **Mid-exam leak:** starts in shift 3 at 2 centres, to exercise the CUSUM.

**What the dashboard shows**
- Precision and recall against the known answers.
- The false-positive rate you actually got versus the target rate.
- The honest look-alikes the system correctly did *not* flag. This is the trust slide.
- Optional check on real data: the licensure dataset with known compromised items that comes with the Cizek & Wollack (2017) handbook.

### References

- Choe, Zhang & Chang 2018, *Psychometrika* 83:650–673.
- Cizek & Wollack (eds.) 2017, *Handbook of Quantitative Methods for Detecting Cheating on Tests*.
- Eckerly 2021, *APM* 45 ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8361375/)).
- [Gorney & Wollack 2025](https://journals.sagepub.com/doi/10.3102/10769986241248770), *JEBS* 50:449–470.
- Holland 1996, ETS PR-96-4.
- Jacob & Levitt 2003, *QJE* 118:843–877.
- Karabatsos 2003, *AME* 16:277–298.
- Marianti et al. 2014, *JEBS* 39:426–451.
- Maynes 2014, in *Test Fraud* (Routledge).
- [Peng 2024](https://educationaldatamining.org/edm2024/proceedings/2024.EDM-posters.105/index.html), EDM poster.
- Sinharay 2017, *JEBS* 42:46–68.
- [Sinharay 2020](https://doi.org/10.1177/0146621620909893), *APM* 44:376–392.
- Snijders 2001, *Psychometrika* 66:331–342.
- van der Linden 2006, *JEBS* 31:181–204.
- van der Linden & Guo 2008, *Psychometrika* 73:365–384.
- van der Linden & Sotaridona 2006, *JEBS* 31:283–304.
- Veerkamp & Glas 2000, *JEBS* 25:373–389.
- Wise & Kong 2005, *AME* 18:163–183.
- Wollack 1997, *APM* 21:307–320.
- Wollack & Maynes 2017, in the Cizek & Wollack handbook.
- Wollack, Cohen & Eckerly 2015, in *Handbook of Test Security*.
- [Zopluoglu 2026](https://onlinelibrary.wiley.com/doi/10.1111/jedm.70030), *JEM*.