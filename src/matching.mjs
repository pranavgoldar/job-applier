export const statuses = [
  "New match",
  "Preparing",
  "Needs my input",
  "Ready for final step",
  "Submitting",
  "Applied",
  "Submission uncertain",
  "Assessment / Interview",
  "Rejected",
  "Offer",
  "Withdrawn",
  "Closed",
];
// A fresh installation has no verified personal information. Existing private profiles are preserved.
export const initialProfile = {
  name: "",
  email: "",
  phone: "",
  education: "",
  graduation: "2027-05",
  cpi: "",
  fullTimeStart: "2027-05-15",
  internshipAvailability:
    "Confirm internship availability and study-compatible hours",
  location: "India",
  workAuthorization: "Unknown — confirm for each country",
  skills: [],
  experience: "",
  facts: "",
};

const count = (s, terms) =>
  terms.reduce((n, t) => n + (s.includes(t) ? 1 : 0), 0);
export function classify(job) {
  const d = (job.description || "").toLowerCase(),
    title = (job.title || "").toLowerCase();
  const p = count(d, [
    "product discovery",
    "user research",
    "roadmap",
    "product analytics",
    "product strategy",
    "product requirements",
    "product metrics",
    "experimentation",
    "prd",
    "product lifecycle",
    "feature priorit",
    "customer discovery",
  ]);
  const f = count(d, [
    "founder",
    "business operations",
    "business strategy",
    "strategic initiatives",
    "cross-functional execution",
    "financial model",
    "market expansion",
    "fundraising",
    "chief of staff",
    "strategy and operations",
    "strategy & operations",
    "special projects",
    "operating cadence",
  ]);
  const fallback = /product|apm/.test(title)
    ? "Product"
    : /founder|operations|strategy|chief of staff|business analyst/.test(title)
      ? "Founder’s Office"
      : null;
  const track =
    p > f
      ? "Product"
      : f > p
        ? "Founder’s Office"
        : fallback || "Founder’s Office";
  const ambiguous = (p > 0 && f > 0 && Math.abs(p - f) < 3) || p === f;
  return {
    track,
    ambiguous,
    responsibilitySignals: { product: p, founders: f },
    reason:
      p + f === 0
        ? `Responsibilities lack clear signals; provisional ${track} recommendation from title, review required.`
        : `Responsibilities contain ${p} Product and ${f} business strategy / operations signals. ${track === "Product" ? "Discovery, roadmap and product decisions" : "Founder support, business strategy and execution"} favor the ${track} resume.${ambiguous ? " Overlap requires your review." : ""}`,
  };
}
export function assess(job, profile = initialProfile) {
  const c = classify(job),
    t = ((job.title || "") + " " + (job.description || "")).toLowerCase(),
    d = (job.description || "").toLowerCase(),
    loc = (job.location || "").toLowerCase();
  const blocked = [],
    review = [],
    evidence = [];
  const years = [
    ...d.matchAll(/(\d+)\s*(?:[-–]\s*(\d+)|\+)\s*years?/g),
    ...d.matchAll(/(?:minimum|at least|requires?|required)\s+(\d+)\s+years?/g),
  ];
  let requiredYears = years.length
    ? Math.max(...years.map((m) => Number(m[2] || m[1])))
    : null;
  if (requiredYears > 2)
    blocked.push("Experience requirement exceeds two years.");
  else if (requiredYears > 1)
    review.push("1–2 years required; internship evidence must be reviewed.");
  else if (
    requiredYears === null &&
    !/freshers?|no experience|graduate|entry.level/.test(t)
  )
    review.push("Required experience is unknown.");
  else evidence.push("Early-career or graduate responsibilities.");
  if (
    /\b(senior|director|head of|vice president|principal|lead product)\b/.test(
      job.title?.toLowerCase() || "",
    )
  )
    blocked.push("Seniority is outside early-career targets.");
  const internship = /intern/i.test(
    (job.employmentType || "") + " " + (job.title || ""),
  );
  const remote = job.workplaceType
    ? job.workplaceType.toLowerCase() === "remote"
    : /remote/.test(loc) ||
      job.isRemote === true ||
      /fully remote|remote (?:role|position|internship|across|from)/.test(d);
  const uncertainCountry =
    /india eligibility.*confirmation|country terms.*confirmation/.test(loc);
  const explicitIndia =
    !uncertainCountry &&
    (/india|worldwide|anywhere in the world|globally remote|any country/.test(
      loc,
    ) ||
      /remote(?:ly)? (?:from|across|in) india|based (?:anywhere )?in india|india[- ]based (?:applicants|candidates)|applicants based in india (?:are|can)|anywhere in india|globally remote|worldwide|any country/.test(
        d,
      ));
  const restricted =
    /\b(us|usa|uk|united states|united kingdom|canada|europe|emea|eu|singapore|uae)\s*(?:only|based|residents)|(?:must|need to) be (?:based|located) in (?:the )?(?:us|uk|usa|united states|united kingdom|canada|europe)/.test(
      d + " " + loc,
    );
  let remoteEligibility = remote
    ? restricted
      ? "Remote restricted to another country"
      : explicitIndia
        ? /worldwide|anywhere in the world|globally remote|any country/.test(
            loc + " " + d,
          )
          ? "Worldwide remote"
          : "India remote"
        : "Remote eligibility unknown"
    : "Onsite / hybrid / unknown";
  if (remote && restricted)
    blocked.push("Remote-country restriction excludes India.");
  if (internship && !remote)
    review.push("Onsite/hybrid internship availability is unconfirmed.");
  if (internship && remote && !explicitIndia)
    review.push("Remote internship must explicitly permit work from India.");
  if (
    !internship &&
    !/india|bengaluru|bangalore|mumbai|delhi|gurugram|gurgaon|pune|hyderabad|chennai|noida|singapore|dubai|uae|abu dhabi|united arab emirates/.test(
      loc,
    ) &&
    !remote
  )
    review.push("Location is outside target geographies or unknown.");
  if (internship)
    review.push("Confirm internship hours are compatible with studies.");
  const start = job.startDate || null;
  if (!internship && start && start < profile.fullTimeStart)
    blocked.push("Full-time joining date precedes mid-May 2027 availability.");
  else if (!internship && !start)
    review.push("Joining date unknown; confirm mid-May 2027 compatibility.");
  if (
    !internship &&
    /2026 (?:graduates?|graduation|batch)|graduat(?:ed|ing) (?:in|by) 2026/.test(
      d,
    )
  )
    blocked.push("Graduation cohort excludes May 2027.");
  if (
    /(?:must|required|essential).{0,35}\bfigma\b|\bfigma\b.{0,20}(?:required|essential)/.test(
      d,
    )
  )
    blocked.push("Mandatory Figma experience is not in the verified profile.");
  const auth =
    (job.description || "").match(
      /[^.!?\n]*(?:authori[sz]ation|sponsor(?:ship)?|right to work|work permit|citizenship)[^.!?\n]*/gi,
    ) || [];
  if (
    /(?:must|require).{0,45}(?:us citizen|singapore citizen|uk citizen)/.test(d)
  )
    blocked.push("Explicit citizenship restriction is not verified.");
  if (!auth.length)
    review.push("Work authorization / sponsorship wording unknown.");
  else
    review.push(
      "Review employer work-authorization wording; do not infer eligibility.",
    );
  if (c.ambiguous)
    review.push(
      "Overlapping responsibilities: approve or override the recommended resume.",
    );
  const fintech =
    /fintech|payments|remittance|digital bank|lending|financial infrastructure|investment platform|banking|financial institution|financial services/.test(
      t + " " + (job.industry || ""),
    );
  const relevant =
    /product|apm|founder|business operations|strategy|strategic|chief of staff|special projects/.test(
      t,
    );
  const parts = {
    role: relevant ? 30 : 0,
    seniority:
      requiredYears === null
        ? 10
        : requiredYears <= 1
          ? 20
          : requiredYears <= 2
            ? 10
            : 0,
    industry: fintech ? 25 : 10,
    skills: Math.min(
      15,
      count(d, [
        "research",
        "sql",
        "api",
        "automation",
        "financial model",
        "discovery",
      ]) * 3,
    ),
    evidence:
      c.responsibilitySignals.product + c.responsibilitySignals.founders > 0
        ? 10
        : 3,
  };
  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  if (fintech)
    evidence.push("Fintech focus: financial products or infrastructure.");
  else
    evidence.push(
      "Other-industry opportunity; assess fit against strategy, research and automation experience.",
    );
  return {
    ...c,
    score,
    parts,
    blocked,
    review,
    evidence,
    requiredYears,
    remoteEligibility,
    employmentType: internship ? "Internship" : job.employmentType || "Unknown",
    workAuthorization: auth,
    decision:
      blocked.length || !relevant ? "Skip" : review.length ? "Review" : "Apply",
    scoreLabel: "Relevance estimate, not a hiring probability",
  };
}
