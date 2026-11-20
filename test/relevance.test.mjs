import { test } from "node:test";
import assert from "node:assert/strict";
import { assess, geo, isTargetRole } from "../src/matching.mjs";

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
    for (const suffix of [
      "Intern",
      "Trainee",
      "Apprentice",
      "(3-month contract)",
    ]) {
      const a = assess({ title: "Product Analyst " + suffix, location });
      assert.equal(a.unsuitable, null);
      assert.equal(a.employmentType, "Internship");
      assert.equal(a.track, "Product");
    }
  }
  for (const override of [
    { location: "Bengaluru" },
    { location: "Remote" },
    { location: "Remote – Singapore" },
    { location: "Bengaluru (Remote)", workplaceType: "Hybrid" },
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
  for (const city of ["Bangalore", "Mumbai", "Noida", "Dubai", "Singapore"]) {
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
