# Career OS Autofill (Chrome extension)

Fills job application forms from your Career OS dashboard. You check the form and press Submit yourself; the dashboard then moves the job to Applied.

## Install (one time)

1. In the dashboard, open **Applications** and click **Download extension**. Unzip the file. You get a folder called `career-os-extension`.
2. In Chrome, open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `career-os-extension` folder.
4. Refresh the dashboard. The Applications page shows "Autofill is connected".

To update later, download the zip again, replace the folder, and click the reload icon on the extension's card.

## How it works

1. You press **Apply** on a job in the dashboard.
2. The extension opens the application in a new tab. Where a site shows its form only after its own "Apply" or "Apply for This Job" button, the extension presses that button once.
3. It fills your name, email, phone and saved answers (Settings → Application answers), and attaches the resume for that kind of role. Internships get your internship pay answer; full-time jobs get the full-time one.
4. A panel in the corner lists what is left for you, for example "Why do you want to work here?". Click an item to jump to it. Multi-step forms are filled step by step as each step appears.
5. You check everything and press the page's Submit button.
6. When the employer's confirmation page appears, the dashboard records the job as Applied, labelled "browser-detected", with the exact resume the extension attached. If the page is not detected, or the extension attached no resume, the dashboard asks you to record it yourself.

## What it will and will not do

- It never presses Submit and never ticks consent or declaration boxes.
- It never overwrites a value already on the form.
- It answers a yes/no question only when you saved an answer for exactly that kind of question. It does not answer demographic questions (gender, age, disability) or free-text questions.
- A pay answer in rupees (LPA, lakh, ₹) is not typed into a question asking in another currency (AED, SGD, USD); that question is left for you.
- The only button it presses is a site's own "Apply", "Apply now", "Apply for this job" or "I'm interested" button outside the form, and only on the employer's own site. Never "Apply with LinkedIn", never a link to another site, never a button inside the form.

## Where it works

On any site, but only in a tab it opened for an application from your dashboard, or a tab where you press the extension's **Fill this page** button. That includes employers' own careers sites (for example a Teamtailor site on the company's domain) and forms embedded in a company page.

Because of that, Chrome asks for permission to "read and change data on all websites" when you install or reload it. It does nothing on a page unless one of those two things happened in that tab.

Tested on live forms from Lever, Greenhouse, Ashby, Pinpoint, Rippling, BambooHR and Teamtailor, without submitting. SmartRecruiters shows a bot check to an automated test browser, so it has not been tested there; your own browser will not see that check.

## Updating

Download the zip again from the dashboard, replace the folder, open `chrome://extensions` and press the reload icon on the Career OS Autofill card. Chrome will ask once for the wider permission described above.

## Your data

Your details and resume go from your dashboard to the application tab you opened, inside your own browser. They are held in the browser's session storage and cleared when Chrome closes. Nothing is sent anywhere else.

## Using a different dashboard address

The extension talks to the dashboard at `https://job-applier-beta.vercel.app` and to `localhost`. If your dashboard moves, change the first `matches` list in `manifest.json` and reload the extension.
