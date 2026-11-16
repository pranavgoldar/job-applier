// Reusable answers for the questions application forms ask again and again.
// The browser extension matches a form question to one of these by its wording
// (see extension/fill.js) and fills in what you saved here. Nothing is guessed.
export const answerFields = [
  { id: "linkedin", label: "LinkedIn profile link", type: "url" },
  { id: "portfolio", label: "Portfolio or personal site", type: "url" },
  { id: "github", label: "GitHub link", type: "url" },
  { id: "city", label: "Current city", type: "text", hint: "e.g. Bengaluru" },
  { id: "country", label: "Country", type: "text", hint: "e.g. India" },
  { id: "currentCompany", label: "Current company", type: "text" },
  { id: "currentTitle", label: "Current job title", type: "text" },
  {
    id: "experienceYears",
    label: "Total years of experience",
    type: "text",
    hint: "e.g. 0.6",
  },
  {
    id: "noticePeriod",
    label: "Notice period",
    type: "text",
    hint: "e.g. Immediate",
  },
  { id: "availability", label: "When can you join", type: "text" },
  { id: "currentCtc", label: "Current CTC", type: "text" },
  { id: "expectedCtc", label: "Expected CTC", type: "text" },
  { id: "college", label: "College or university", type: "text" },
  { id: "degree", label: "Degree", type: "text" },
  { id: "graduationYear", label: "Graduation year", type: "text" },
  { id: "howHeard", label: "How did you hear about us", type: "text" },
  { id: "relocate", label: "Willing to relocate", type: "yesno" },
  {
    id: "workAuthorization",
    label: "Legally authorised to work in the job’s country",
    type: "yesno",
  },
  { id: "sponsorship", label: "Need visa sponsorship", type: "yesno" },
  {
    id: "relativeAtCompany",
    label: "A relative works at the company",
    type: "yesno",
  },
  {
    id: "previouslyEmployed",
    label: "Worked at the company before",
    type: "yesno",
  },
  {
    id: "backgroundCheck",
    label: "Consent to a background check",
    type: "yesno",
  },
];
const ids = new Set(answerFields.map((f) => f.id));
export function cleanAnswers(input = {}) {
  const out = {};
  for (const f of answerFields) {
    const v = input[f.id];
    if (typeof v !== "string" || !v.trim()) continue;
    if (f.type === "yesno" && !["Yes", "No"].includes(v.trim())) continue;
    out[f.id] = v.trim().slice(0, 500);
  }
  return out;
}
export const isAnswerId = (id) => ids.has(id);
