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

// This order chooses a single display city for multi-location postings.
const preferredIndianCities = [
  ["Bangalore", /\b(?:bengaluru|bangalore|blr)\b/i],
  ["Mumbai", /\b(?:mumbai|bombay)\b|^(?:mum|bom)(?:$|[, /(-])/i],
  ["Hyderabad", /\bhyderabad\b|^hyd(?:$|[, /(-])/i],
  ["Delhi", /\b(?:new delhi|delhi)\b|^del(?:$|[, /(-])/i],
];
const indianCities = [
  ...preferredIndianCities,
  ["Gurugram", /\b(?:gurgaon|gurugram)\b/i],
  ...[
    "Noida",
    "Pune",
    "Chennai",
    "Kolkata",
    "Ahmedabad",
    "Jaipur",
    "Kochi",
    "Indore",
    "Thane",
    "Chandigarh",
    "Coimbatore",
    "Lucknow",
    "Bhubaneswar",
    "Visakhapatnam",
    "Surat",
    "Patna",
    "Bhopal",
    "Nagpur",
    "Guwahati",
    "Faridabad",
    "Mysuru",
    "Vadodara",
  ].map((city) => [city, new RegExp("\\b" + city + "\\b", "i")]),
];

const indianState =
  /\b(?:andhra pradesh|arunachal pradesh|assam|bihar|chhattisgarh|goa|gujarat|haryana|himachal pradesh|jharkhand|karnataka|kerala|madhya pradesh|maharashtra|manipur|meghalaya|mizoram|nagaland|odisha|orissa|punjab|jammu (?:and|&) kashmir|rajasthan|sikkim|tamil nadu|telangana|tripura|uttar pradesh|uttarakhand|west bengal|ladakh|puducherry|lakshadweep|andaman and nicobar islands|dadra and nagar haveli|daman and diu)\b/i;
function indiaLocation(job, loc) {
  // Country codes from an ATS are authoritative. In free text, “IN” can also mean Indiana.
  if (job.locationCountry && !/^(?:in|ind|india)$/i.test(job.locationCountry))
    return null;
  if (Array.isArray(job.remoteCountries) && job.remoteCountries.length) {
    return job.remoteCountries.some((country) =>
      /^(?:in|india)$/i.test(country),
    )
      ? "India (city not stated)"
      : null;
  }
  const places = loc
    .split(";")
    .map((s) => s.trim())
    .filter(
      (s) =>
        !/\b(?:pakistan|sindh|louisiana|new york state|ontario|united states)\b|,\s*(?:NY|LA|OH|CA|US|USA)\s*$/i.test(
          s,
        ),
    );
  // Only interpret the short airport codes as location fields (e.g. DEL, not Mar del Plata).
  const known = indianCities.find(([, pattern]) =>
    places.some((place) => pattern.test(place)),
  );
  if (known) return known[0];
  if (job.locationCity && job.locationCountry) return job.locationCity;
  let countryOnly = !!job.locationCountry;
  for (const place of places) {
    if (!/\bindia\b/i.test(place) && !indianState.test(place)) continue;
    countryOnly = true;
    const fields = place
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const city = fields.find(
      (field) =>
        !/\b(?:india|remote|anywhere|nationwide|hybrid|onsite)\b/i.test(
          field,
        ) &&
        !indianState.test(field) &&
        !/^[A-Z]{2}$/.test(field),
    );
    if (city) return city;
  }
  return countryOnly ? "India (city not stated)" : null;
}

export function geo(job) {
  const loc = String(job.location || "");
  const d = String(job.description || "");
  const indianCity = indiaLocation(job, loc);
  const india = !!indianCity;
  const remote =
    !/hybrid|on[- ]?site|in[- ]office|not remote/i.test(
      [job.workplaceType, loc].join(" "),
    ) &&
    (job.isRemote === true ||
      /remote/i.test(job.workplaceType || "") ||
      /\b(?:remote|work from home|wfh|worldwide|anywhere)\b/i.test(loc) ||
      /\b(?:fully remote|remote (?:role|position|internship|across|from|within))\b/i.test(
        d,
      ));
  const worldwide =
    /worldwide|anywhere in the world|globally remote|any country/i.test(loc) ||
    /(?:work|remote) (?:from )?(?:anywhere in the world|worldwide|any country)|globally remote (?:role|position)/i.test(
      d,
    );
  const restricted =
    job.indiaEligible === false ||
    /\b(us|usa|uk|united states|united kingdom|canada|europe|emea|eu|singapore|uae)[- ]+(?:only|residents)|(?:must|need to) be (?:based|located) in (?:the )?(?:us\b|uk\b|usa|united states|united kingdom|canada|europe|singapore|uae)/i.test(
      d + " " + loc,
    );
  const countryList = job.remoteCountries;
  const indiaRemote =
    remote &&
    !restricted &&
    (Array.isArray(countryList)
      ? !countryList.length ||
        countryList.some((country) => /^(india|in)$/i.test(country))
      : !/india eligibility.*confirmation|country terms.*confirmation/i.test(
          loc,
        ) &&
        (india ||
          worldwide ||
          /remote(?:ly)? (?:from|across|within|in) india|based (?:anywhere )?in india|india[- ]based (?:applicants|candidates)|anywhere in india/i.test(
            d,
          )));
  const remoteEligibility = !remote
    ? "Onsite / hybrid / unknown"
    : indiaRemote
      ? (Array.isArray(countryList) ? !countryList.length : worldwide)
        ? "Worldwide remote"
        : "India remote"
      : restricted || countryList?.length || /remote\s*[-–·,]\s*\w/i.test(loc)
        ? "Remote restricted to another country"
        : "Remote eligibility unknown";

  let region = indianCity;
  if (region === "India (city not stated)" && remote) region = "Remote · India";
  if (!region)
    region =
      ["Dubai", "Singapore", "Abu Dhabi", "Sharjah"].find((city) =>
        loc.toLowerCase().includes(city.toLowerCase()),
      ) ||
      (/\buae\b|united arab emirates/i.test(loc)
        ? "UAE (city not stated)"
        : null);
  if (!region && indiaRemote) region = "Remote";
  const preferredIndex = preferredIndianCities.findIndex(
    ([city]) => city === region,
  );
  const points =
    preferredIndex >= 0
      ? 20 - preferredIndex
      : india || indiaRemote
        ? 14
        : region === "Dubai"
          ? 13
          : region === "Singapore"
            ? 11
            : region
              ? 10
              : 0;
  // An overseas remote board can be a full-time destination in its own right.
  const foreignRegion = [
    "Dubai",
    "Singapore",
    "Abu Dhabi",
    "Sharjah",
    "UAE (city not stated)",
  ].includes(region);
  const allowedCountries = Array.isArray(countryList) ? countryList : [];
  const foreignTargetRemote =
    remote &&
    foreignRegion &&
    (!allowedCountries.length ||
      allowedCountries.some((country) =>
        region === "Singapore"
          ? /^(singapore|sg)$/i.test(country)
          : /^(united arab emirates|uae|ae)$/i.test(country),
      )) &&
    !/\b(?:us|usa|uk|united states|united kingdom|canada|europe)[- ]only|must be (?:based|located) in (?:the )?(?:us\b|uk\b|united states|united kingdom|canada|europe)/i.test(
      loc + " " + d,
    );
  return {
    region,
    points,
    remote,
    indiaRemote,
    matchesIndia: remote ? indiaRemote : india,
    foreignTargetRemote,
    remoteEligibility,
  };
}
export function sectorOf(job, text = "") {
  const industry = String(job.industry || "").toLowerCase();
  if (industry.startsWith("consumer")) return "Consumer";
  if (
    /fintech|payments|remittance|digital bank|lending|financial infrastructure|investment platform|banking|financial institution|financial services|crypto|wealth|insurance|neobank|broking/.test(
      text + " " + industry,
    )
  )
    return "Fintech";
  if (
    /consumer|marketplace|commerce|food|mobility|travel|social|media|gaming|d2c|entertainment|delivery|audio|edtech|health/.test(
      industry,
    )
  )
    return "Consumer";
  return "Other";
}

const PRODUCT = "Product management",
  STRATEGY = "Strategy & Operations",
  FOUNDERS = "Founder’s Office";
const senior =
  /\b(?:senior|sr|staff|director|head|vice president|vp|avp|principal|lead|group|general manager|dgm|gm|agm|ii|iii|iv|v|vi)\b|\b(?:level|manager)\s+[2-9]\b/i;
const excludedFamily =
  /engineer(?:ing)?\b|developer\b|design(?:er)?\b|marketing|counsel|compliance|support|recruit|account executive|\bsales\b|\bhr\b|talent acquisition|social media|\bfinance\b|financial (?:data|analyst)|fp\s*&\s*a|\brisk\b|data product|product (?:ops|operations|research|analytics)|data analy(?:st|tics)|vip product|(?:customer|driver|warehouse|payments?|affiliate|crm|growth|campaigns?|ads|people|commercial) (?:strategy|ops\b|operations|implementation)|growth management|lending reserve/i;
export function blockedTitle(job) {
  const title = String(job.title || "").replace(/chief of staff/gi, "");
  return senior.test(title) || excludedFamily.test(title);
}
const internWord =
  /\bintern(?:ship)?s?\b|\btrainee\b|\bapprentice(?:ship)?\b|working student|\bco-?op\b/i;
function employment(job, years) {
  const label = job.employmentType || "";
  const title = job.title || "";
  const fixedTerm =
    /\b(?:[1-6]|one|two|three|four|five|six)[- ]months?\s+(?:fixed[- ]term|contract(?:or)?|assignment|placement)|(?:contract|fixed[- ]term|placement)\s*(?:of|for|:)?\s*(?:[1-6]|one|two|three|four|five|six)[- ]months?\b/i;
  if (fixedTerm.test([title, label, job.description].join(" "))) {
    const explicitIntern =
      /\bintern(?:ship)?s?\b|\btrainee\b|\bapprentice(?:ship)?\b/i.test(title);
    return explicitIntern || years?.min === 0 ? "Internship" : null;
  }
  if (internWord.test(title + " " + label)) return "Internship";
  if (/part[- ]?time|contract|freelance|temporary/i.test(label)) return null;
  return "Full-time";
}

// Keep the employer's range for display and retain both ends when the employer gives a range.
function experienceAsked(title = "", description = "", level = "") {
  const text = [title, description, level && "Experience: " + level]
    .filter(Boolean)
    .join(". ")
    .toLowerCase()
    .replace(/\s+/g, " ");
  let best = null;
  for (const m of text.matchAll(
    /\b(\d{1,2})(?:\s*(?:[-–—]|to)\s*(\d{1,2}))?\s*(\+)?\s*(?:years?|yrs?)\b/g,
  )) {
    const before = text.slice(Math.max(0, m.index - 65), m.index);
    const after = text.slice(
      m.index + m[0].length,
      m.index + m[0].length + 120,
    );
    const lead =
      /\b(?:experience|exp|minimum|min|at least|requires?|must have|you have|you bring|having)\s*(?:of|:|[-–]|is)?\s*$/.test(
        before,
      );
    const qualification =
      /^\s*(?:of\s+)?(?:(?:relevant|prior|professional|practical|hands-on|work|industry)\s+)*(?:experience|expertise|background)|^\s*(?:required|needed|working|building|managing|leading|delivering|developing)\b|^\s*(?:in|of)\s+(?:a |an |the )?(?:[\w/-]+\s+){0,4}(?:management|strategy|recommendation|operations|planning|analytics|consulting|role|position|development|design|experience|product)\b/.test(
        after,
      );
    const history =
      /(?:we(?: have)? (?:operated|served|worked)|founded|established|company has|company with|track record of serving)[^.!?]{0,25}$/.test(
        before,
      );
    const standalone =
      /(?:^|[.(:;|])\s*$/.test(before) && /^\s*(?:[).;|]|$)/.test(after);
    if (history || (!lead && !qualification && !standalone)) continue;
    const min = Number(m[1]);
    const max = m[2] ? Number(m[2]) : min;
    if (!best || min > best.min || (min === best.min && max > best.max))
      best = { min, max, label: m[0] };
  }
  if (best) return best;
  return /\b(?:no|without|zero) (?:prior |previous |work )?experience (?:is )?(?:required|needed|necessary)|freshers? (?:welcome|can apply|are welcome)/.test(
    text,
  )
    ? { min: 0, max: 0, label: "No experience required" }
    : null;
}
export function requiredExperience(title, description) {
  return experienceAsked(title, description)?.min ?? null;
}
const duties = {
  [PRODUCT]: [
    "product discovery",
    "user research",
    "roadmap",
    "product requirements",
    "product metrics",
    "product lifecycle",
    "feature priorit",
    "customer discovery",
    "product strategy",
  ],
  [STRATEGY]: [
    "business operations",
    "business strategy",
    "strategic initiatives",
    "business planning",
    "operating cadence",
    "market expansion",
    "strategy and operations",
    "strategy & operations",
  ],
  [FOUNDERS]: [
    "fundraising",
    "financial model",
    "market expansion",
    "founder support",
    "business operations",
    "special projects",
  ],
};
function classifyRole(job, years) {
  const title = String(job.title || "").toLowerCase();
  const d = String(job.description || "").toLowerCase();
  const found = Object.fromEntries(
    Object.entries(duties).map(([name, terms]) => [
      name,
      terms.filter((term) => d.includes(term)),
    ]),
  );
  const founderWork =
    /(?:support|work(?:ing)? (?:closely )?with|report(?:ing)? to|partner with) (?:the |our )?(?:co-?)?founder|founder support|founder.s office|office of the ceo/.test(
      d,
    );
  if (founderWork) found[FOUNDERS].push("direct founder support");
  else found[FOUNDERS] = [];
  const junior =
    /\b(?:junior|jr\.?|early[- ]career|entry[- ]level|associate product manager|graduate product manager|product manager i)\b/i.test(
      title + " " + (job.experienceLevel || ""),
    ) ||
    /\b(?:junior|early[- ]career|entry[- ]level) (?:role|position|candidate|professional|chief of staff|product manager)\b|\b(?:role|position) is (?:junior|early[- ]career|entry[- ]level)\b/i.test(
      d,
    );
  const chief = /\bchief of staff\b/.test(title);
  let category = null,
    matchedBy = null;
  const productTitle =
    /\bapm\b|\bproduct (?:management|analyst|associate|intern|strategy|owner)\b|\b(?:intern|internship)[ ,/-]+product\b/;
  const strategyTitle =
    /\b(?:strategy (?:&|and) operations|business operations|biz\s?ops|strategic initiatives|(?:business|strategic) planning|strategy (?:associate|analyst|intern)|(?:associate|analyst|intern)[, /-]+strategy)\b/;
  const foundersTitle =
    /\bfounder[’'s]* (?:office|associate)|office of (?:the )?ceo|ceo[’'s]* office|associate to (?:the )?founder/;
  const eligibleChief = !chief || (years ? years.min <= 2 : junior);
  const manager = /\bproduct manager\b/.test(title);
  const eligibleManager =
    !manager || junior || internWord.test(title) || (!!years && years.min <= 2);
  const outsideFamily = blockedTitle(job);
  const missingLevel = !outsideFamily && (!eligibleChief || !eligibleManager);
  if (!outsideFamily && !missingLevel) {
    if (chief || foundersTitle.test(title)) category = FOUNDERS;
    else if (productTitle.test(title) || manager) category = PRODUCT;
    else if (strategyTitle.test(title) && !/\bmanager\b/.test(title))
      category = STRATEGY;
    if (category) matchedBy = "title";
    const generic =
      /^(?:(?:junior|graduate|business|operations|management) )?(?:associate|analyst|intern|trainee)\b|\b(?:accelerat(?:or|ion)|builders|rotational|graduate|internship) program(?:me)?\b/.test(
        title,
      );
    if (category || generic) {
      const [winner, runnerUp] = Object.keys(found).sort(
        (a, b) => found[b].length - found[a].length,
      );
      if (
        found[winner].length >= 3 &&
        found[winner].length > found[runnerUp].length &&
        (!category || winner !== category)
      ) {
        category = winner;
        matchedBy = "responsibilities";
      }
    }
  }
  const ambiguous =
    !!category &&
    Object.values(found).filter((terms) => terms.length >= 2).length > 1;
  return {
    category,
    matchedBy,
    ambiguous,
    track: category === PRODUCT ? "Product" : category ? FOUNDERS : null,
    reason: !category
      ? missingLevel
        ? "Not marked as early-career"
        : "Outside the three target roles."
      : matchedBy === "responsibilities"
        ? "The role involves " + found[category].slice(0, 3).join(", ") + "."
        : "The title matches " + category + ".",
  };
}
export function classify(job) {
  return classifyRole(
    job,
    experienceAsked(job.title, job.description, job.experienceLevel),
  );
}
export function roleMatch(job) {
  return classify(job).matchedBy;
}
export function isTargetRole(job) {
  return !!roleMatch(job);
}

function locationIssue(place, type) {
  if (type === "Internship") {
    if (!place.remote)
      return ["Bangalore", "Mumbai"].includes(place.region)
        ? null
        : "This internship is on-site or hybrid outside Bangalore and Mumbai.";
    if (!place.indiaRemote)
      return place.remoteEligibility + ". Remote work must be open to India.";
  } else if (place.remote && !place.indiaRemote && !place.foreignTargetRemote) {
    return "Remote location is outside the target locations or not stated.";
  }
  return place.region ? null : "Outside the target locations.";
}

export function isTargetLocation(job) {
  const type = employment(
    job,
    experienceAsked(job.title, job.description, job.experienceLevel),
  );
  return !locationIssue(geo(job), type);
}

// Only dates tied to a start or joining requirement qualify. Ignore posting dates and deadlines.
function startDate(job) {
  const text = [job.title, job.description].join(". ");
  const match = text.match(
    /\b(?:must (?:be able to )?(?:start|join)(?: on| by)?|(?:required )?(?:start|joining) date\s*(?:is|of|[:–-]))\s*(\d{4}-\d\d-\d\d|\d{1,2}\s+[a-z]{3,9}\s+\d{4}|[a-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/i,
  );
  const flexible =
    match &&
    /(?:preferred|proposed|ideal|tentative|earliest|flexible|anticipated)\s*$/i.test(
      text.slice(0, match.index),
    );
  const stated = job.startDate || (!flexible && match?.[1]);
  if (!stated) return null;
  const stamp = Date.parse(stated);
  return Number.isFinite(stamp)
    ? new Date(stamp).toISOString().slice(0, 10)
    : null;
}
export function assess(job, profile = initialProfile) {
  const years = experienceAsked(
    job.title,
    job.description,
    job.experienceLevel,
  );
  const c = classifyRole(job, years);
  const place = geo(job);
  const type = employment(job, years);
  const start = type === "Full-time" ? startDate(job) : null;
  const text = [job.title, job.description].join(" ");
  const blocked = [],
    review = [];
  if (
    senior.test(String(job.title || "").replace(/chief of staff/gi, "")) ||
    /mid.?senior|director|executive/i.test(job.experienceLevel || "")
  )
    blocked.push("Seniority is outside early-career targets.");
  const experienceLabel =
    years?.min <= 2 && years.max > 2
      ? `Stretch: asks ${years.min}–${years.max} years`
      : years?.label || "Experience not stated";
  if (years?.min > 2)
    blocked.push("Experience requirement: " + years.label + ".");
  else if (years?.min >= 1)
    review.push("Experience requested: " + years.label + ".");
  if (start && profile.fullTimeStart && start < profile.fullTimeStart)
    blocked.push(
      "Full-time joining date " +
        start +
        " is before your availability on " +
        profile.fullTimeStart +
        ".",
    );
  const locationReason = locationIssue(place, type);
  if (locationReason) blocked.push(locationReason);
  if (!type) blocked.push("Outside full-time and internship employment types.");
  const cohort = text.match(
    /\b(20\d{2}) (?:graduates?|graduation|batch) only\b/i,
  );
  if (
    cohort &&
    profile.graduation &&
    cohort[1] !== profile.graduation.slice(0, 4)
  )
    blocked.push(cohort[0]);
  const nationality = text.match(
    /\b(?:UAE|Saudi|Singapore|Emirati|US|UK) (?:nationals?|citizens?) only\b/i,
  );
  if (nationality) blocked.push(nationality[0]);
  if (
    /(?:must|required|essential).{0,35}\bfigma\b|\bfigma\b.{0,20}(?:required|essential)/i.test(
      text,
    )
  )
    blocked.push("Mandatory Figma experience is not in the verified profile.");
  const auth =
    String(job.description || "").match(
      /[^.!?\n]*(?:work authori[sz]ation|visa sponsorship|right to work|work permit|citizenship requirement)[^.!?\n]*/gi,
    ) || [];
  review.push(...auth.map((line) => line.trim()));
  const unsuitable = blocked[0] || (!c.category ? c.reason : null);
  const sector = sectorOf(job, text.toLowerCase());
  const parts = {
    role: c.category ? 30 : 0,
    seniority: years && years.min <= 1 ? 20 : 10,
    industry: sector === "Fintech" ? 20 : sector === "Consumer" ? 15 : 8,
    location: place.points,
    evidence: c.matchedBy === "responsibilities" ? 10 : 5,
  };
  return {
    ...c,
    ...place,
    // A job you added yourself may sit outside the three categories; it still
    // gets a resume, chosen from its title.
    track:
      c.track ??
      (job.addedByYou
        ? /\bproduct\b/i.test(job.title || "")
          ? "Product"
          : FOUNDERS
        : null),
    remoteEligibility:
      type === "Full-time" && place.foreignTargetRemote && !place.indiaRemote
        ? "Remote · " + place.region
        : place.remoteEligibility,
    parts,
    score: Object.values(parts).reduce((a, b) => a + b, 0),
    blocked,
    review,
    unsuitable,
    evidence: c.category ? [c.reason] : [],
    requiredYears: years?.min ?? null,
    experienceLabel,
    sector,
    employmentType: type,
    internshipWorkplace:
      type !== "Internship"
        ? null
        : place.remote
          ? "Remote"
          : /hybrid/i.test([job.workplaceType, job.location].join(" "))
            ? "Hybrid"
            : "On-site",
    historyOnly:
      !!c.category &&
      type === "Internship" &&
      !place.remote &&
      !!locationReason &&
      blocked.length === 1,
    startDate: start,
    workAuthorization: auth,
    decision: unsuitable
      ? "Skip"
      : review.length || c.ambiguous
        ? "Review"
        : "Apply",
    scoreLabel: "Relevance estimate, not a hiring probability",
  };
}
