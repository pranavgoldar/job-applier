import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assess,
  geo,
  isTargetRole,
  isTargetLocation,
} from "../src/matching.mjs";

// Public titles and qualification excerpts from the 16 November snapshot.
test("off-target titles from the labelled snapshot stay outside discovery", () => {
  for (const title of [
    "Binance Accelerator Program - Ads Implementation",
    "Binance Accelerator Program - Affiliate Operations",
    "Binance Accelerator Program - Research Data Analyst",
    "Binance Accelerator Program - CRM Operations (APAC Based)",
    "Growth Management - Telco I Experience 2-4 Years",
    "Business Analyst - Assistant Manager - Lending Reserve",
    "Finance and Strategy Data Analyst",
    "Financial Data Analyst Intern, Technical Operations",
    "Community Marketing Intern",
    "Data Analytics Intern",
    "Intern, Driver Operations",
    "Ads Strategy Manager – Pricing & Revenue",
    "Associate Data Product Manager",
  ])
    assert.equal(isTargetRole({ title }), false, title);
});
test("duration in a professional discipline counts even without the word experience", () => {
  const a = assess({
    title: "AI & Recommendation Product Manager",
    location: "Singapore",
    description:
      "5+ years of internet product management, including 3+ years in recommendation.",
  });
  assert.equal(a.requiredYears, 5);
  assert.match(a.unsuitable, /5\+ years/);
});
test("Chief of Staff needs explicit junior scope or a suitable years requirement", () => {
  const job = { title: "Chief of Staff", location: "Singapore" };
  for (const posting of [
    {
      ...job,
      company: "Tide",
      location: "India, Hyderabad",
      description: "Run weekly and monthly team steercos and business reviews.",
    },
    {
      ...job,
      company: "OKX",
      description:
        "Experience in strategy, business operations, management consulting.",
    },
    { ...job, description: "Manage a team of junior analysts." },
    {
      ...job,
      description: "This is an early-career position. 4 years in strategy.",
    },
  ])
    assert.ok(assess(posting).unsuitable, posting.company);
  for (const description of [
    "0–2 years in strategy",
    "This is an early-career role.",
  ]) {
    const a = assess({ ...job, description });
    assert.equal(a.category, "Founder’s Office");
    assert.equal(a.unsuitable, null);
  }
});
test("program titles qualify only through duties or a specific target-role title", () => {
  for (const title of [
    "Accelerator Program",
    "Builders Program",
    "Graduate Programme",
  ]) {
    assert.equal(isTargetRole({ title }), false);
    const a = assess({
      title,
      location: "Noida",
      description:
        "Own business planning, operating cadence and strategic initiatives.",
    });
    assert.equal(a.category, "Strategy & Operations");
    assert.equal(a.track, "Founder’s Office");
    assert.equal(a.matchedBy, "responsibilities");
  }
});
test("internship eligibility respects the remote workplace and real allowed countries", () => {
  for (const location of [
    "Remote – India",
    "Bengaluru (Remote)",
    "Remote – Worldwide",
  ]) {
    for (const suffix of ["Intern", "Trainee", "Apprentice"]) {
      const a = assess({ title: "Product Analyst " + suffix, location });
      assert.equal(a.unsuitable, null);
      assert.equal(a.employmentType, "Internship");
      assert.equal(a.track, "Product");
    }
  }
  for (const override of [
    { location: "Hyderabad" },
    { location: "Remote" },
    { location: "Remote – Singapore" },
    { location: "Hyderabad (Remote)", workplaceType: "Hybrid" },
    { location: "Remote India", remoteCountries: ["France"] },
    { location: "Remote India", description: "Must be located in Canada." },
  ])
    assert.ok(assess({ title: "BizOps Intern", ...override }).unsuitable);
});
test("full-time availability follows the profile and only a required start affects inclusion", () => {
  const job = { title: "Office of the CEO Associate", location: "Mumbai" };
  const profile = { fullTimeStart: "2028-05-15" };
  for (const description of [
    "",
    "Posted on 2027-04-14.",
    "Preferred start date: 2027-01-01.",
    "Applications close on 2027-05-01.",
  ]) {
    const a = assess({ ...job, description }, profile);
    assert.equal(a.unsuitable, null);
    assert.equal(a.startDate, null);
    assert.deepEqual(a.review, []);
  }
  const dated = { ...job, description: "Must join by May 14, 2028." };
  assert.match(assess(dated, profile).unsuitable, /2028-05-15/);
  assert.equal(assess(dated, { fullTimeStart: "2028-05-14" }).unsuitable, null);
});
test("cities remain specific and use the preferred order", () => {
  let previous = Infinity;
  for (const city of [
    "Bangalore",
    "Mumbai",
    "Hyderabad",
    "Delhi",
    "Noida",
    "Dubai",
    "Singapore",
  ]) {
    const place = geo({ location: city });
    assert.equal(place.region, city);
    assert.ok(place.points < previous);
    previous = place.points;
  }
  assert.equal(geo({ location: "India, Hyderabad" }).region, "Hyderabad");
  assert.equal(
    geo({ location: "Abu Dhabi, UAE; Kuala Lumpur, Malaysia" }).region,
    "Abu Dhabi",
  );
});

test("Coinbase Singapore is eligible for full-time work while remote internships require India", () => {
  const job = {
    company: "Coinbase",
    title: "Product Manager I – International",
    location: "Remote – Singapore",
    description: "2+ years of product management experience.",
  };
  for (const location of [
    "Remote – Singapore",
    "Remote – Dubai",
    "Singapore",
    "Dubai",
  ]) {
    const fullTime = { ...job, location };
    assert.ok(isTargetLocation(fullTime), location);
    assert.equal(assess(fullTime).unsuitable, null);
    const internship = { ...fullTime, employmentType: "Internship" };
    assert.equal(isTargetLocation(internship), false);
    assert.ok(assess(internship).unsuitable);
  }
  assert.equal(assess(job).remoteEligibility, "Remote · Singapore");
  assert.ok(assess({ ...job, location: "Remote – Canada" }).unsuitable);
});
test("FamPay is a stretch at the lower end of a stated range", () => {
  const job = {
    company: "FamPay",
    title: "Product Manager",
    location: "Bengaluru",
    description: "2–4 years of experience in Product Management.",
  };
  const a = assess(job);
  assert.equal(a.unsuitable, null);
  assert.equal(a.category, "Product management");
  assert.equal(a.experienceLabel, "Stretch: asks 2–4 years");
  assert.match(
    assess({
      ...job,
      description: job.description + " Minimum 3 years in fintech operations.",
    }).unsuitable,
    /3 years/,
  );
});
test("level is the reason for hiding unlevelled Binance and Tide roles", () => {
  for (const [company, title, location] of [
    ["Binance", "Product Manager, AI Agent & Harness", "Singapore"],
    ["Tide", "Chief of Staff", "Hyderabad"],
  ]) {
    const a = assess({ company, title, location });
    assert.equal(a.reason, "Not marked as early-career");
    assert.equal(a.unsuitable, a.reason);
  }
});
test("Agoda's six-month assignment is a contract; internships need a title or zero-experience evidence", () => {
  const agoda = assess({
    company: "Agoda",
    title:
      "Manager, Strategic Projects (Marketing Procurement) (Bangkok Based, 6 Months Contract)",
    location: "Bangkok",
    description:
      "More than 8 years of relevant professional experience in management consulting.",
  });
  assert.notEqual(agoda.employmentType, "Internship");
  assert.match(agoda.unsuitable, /8 years/);
  const job = {
    title: "Product Analyst (six-month contract)",
    location: "Bengaluru (Remote)",
  };
  assert.ok(assess(job).unsuitable);
  for (const role of [
    { ...job, description: "No experience required." },
    { ...job, title: "Product Analyst Trainee (six-month contract)" },
  ]) {
    assert.equal(assess(role).employmentType, "Internship");
    assert.equal(assess(role).unsuitable, null);
  }
});

test("full-time search covers India with priority for BLR, Mumbai, Hyderabad and Delhi", () => {
  for (const [location, city] of [
    ["Delhi; HYD; MUM; BLR", "Bangalore"],
    ["New Delhi; HYD; Mumbai", "Mumbai"],
    ["DEL; Hyderabad", "Hyderabad"],
    ["Pune; New Delhi", "Delhi"],
    ["Pan-India", "India (city not stated)"],
    ["Silchar, Assam", "Silchar"],
    ["Aizawl, Mizoram, India", "Aizawl"],
    ["Lucknow", "Lucknow"],
  ]) {
    const a = assess({ title: "Strategy Analyst", location });
    assert.equal(a.unsuitable, null, location);
    assert.equal(a.region, city, location);
    assert.equal(a.matchesIndia, true, location);
  }
  const ats = assess({
    title: "Product Analyst",
    location: "Tezpur",
    locationCountry: "in",
    locationCity: "Tezpur",
  });
  assert.equal(ats.region, "Tezpur");
  for (const location of [
    "Hyderabad, Pakistan",
    "Delhi, NY",
    "Mar del Plata",
    "Indianapolis, IN",
  ]) {
    assert.equal(geo({ location }).matchesIndia, false, location);
  }
  assert.ok(
    assess({ title: "Product Management Intern", location: "Pan-India" })
      .unsuitable,
  );
  assert.equal(geo({ location: "Remote – Singapore" }).matchesIndia, false);
});
