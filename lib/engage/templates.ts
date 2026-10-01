// Ready surveys HR can start from (and change before opening).
import type { Question } from "./rules";

const r = (id: string, text: string): Question => ({ id, text, type: "rating", required: true });
export interface SurveyTemplate { key: string; title: string; kind: string; intro: string; questions: Question[] }

export const SURVEY_TEMPLATES: SurveyTemplate[] = [
  {
    key: "engagement", title: "Employee engagement survey", kind: "engagement",
    intro: "Your answers are anonymous: they carry no name, and results are shown only for groups of 5 or more. About 5 minutes.",
    questions: [
      { id: "q1", text: "How likely are you to recommend us as a place to work to a friend or relative?", type: "enps", required: true },
      r("q2", "I know what is expected of me at work"),
      r("q3", "I have the machines, tools and materials to do my job well"),
      r("q4", "My supervisor cares about me and my safety"),
      r("q5", "I received the training I need for my job"),
      r("q6", "Someone recognised my good work in the last month"),
      r("q7", "My suggestions are listened to and acted on"),
      r("q8", "I feel safe at my workplace"),
      r("q9", "I understand our quality policy and how my work affects the customer"),
      { id: "q10", text: "Do you see yourself working here two years from now?", type: "yesno", required: true },
      { id: "q11", text: "What is one thing we should improve?", type: "text", required: false },
      { id: "q12", text: "What do you like most about working here?", type: "text", required: false },
    ],
  },
  {
    key: "pulse", title: "Monthly pulse", kind: "pulse", intro: "Three quick questions. Anonymous.",
    questions: [
      { id: "q1", text: "How likely are you to recommend us as a place to work?", type: "enps", required: true },
      r("q2", "This month I had what I needed to do good work"),
      { id: "q3", text: "Anything we should know?", type: "text", required: false },
    ],
  },
  {
    key: "canteen", title: "Canteen and transport", kind: "canteen", intro: "Four quick questions. Anonymous.",
    questions: [
      r("q1", "Quality and taste of canteen food"),
      r("q2", "Cleanliness of the canteen and washrooms"),
      { id: "q3", text: "Company bus timing", type: "choice", options: ["Good", "Sometimes late", "Often late", "I do not use the bus"], required: true },
      { id: "q4", text: "Anything else we should know?", type: "text", required: false },
    ],
  },
  {
    key: "new_joiner", title: "New joiner — first 30 days", kind: "custom", intro: "Tell us how your first month went. Anonymous.",
    questions: [
      r("q1", "My joining day was well organised (ID card, safety induction, workplace ready)"),
      r("q2", "I was trained before I was put on the job"),
      r("q3", "My supervisor and team helped me settle in"),
      r("q4", "The job is what was explained to me at the interview"),
      { id: "q5", text: "What would have made your first month better?", type: "text", required: false },
    ],
  },
  {
    key: "exit", title: "Exit survey", kind: "exit", intro: "Please help us improve. Your answers are not shared with your supervisor.",
    questions: [
      { id: "q1", text: "Main reason for leaving", type: "choice", options: ["Salary", "Growth / promotion", "Supervisor", "Work hours / shifts", "Distance / transport", "Higher studies", "Family reasons", "Other"], required: true },
      r("q2", "I was treated fairly here"),
      r("q3", "I had the training and tools I needed"),
      { id: "q4", text: "Would you join us again in future?", type: "yesno", required: true },
      { id: "q5", text: "What should we change?", type: "text", required: false },
    ],
  },
];
