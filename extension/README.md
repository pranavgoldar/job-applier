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
2. The extension opens the employer's application page in a new tab.
3. It fills your name, email, phone, saved answers (Settings → Application answers) and attaches the resume for that kind of role.
4. A panel in the corner lists what is left for you, for example "Why do you want to work here?". Click an item to jump to it.
5. You check everything and press the page's Submit button.
6. When the employer's confirmation page appears, the dashboard records the job as Applied, labelled "browser-detected", with the exact resume the extension attached. If the page is not detected, or the extension attached no resume, the dashboard asks you to record the submission yourself with the resume you used.

## What it will and will not do

- It never presses Submit and never ticks consent or declaration boxes.
- It never overwrites a value already on the form.
- It answers a yes/no question only when you saved an answer for exactly that kind of question. It does not answer demographic questions (gender, age, disability).
- It does not write free-text answers such as cover notes.

## Where it works

Filled automatically after you press Apply: `jobs.lever.co`, `boards.greenhouse.io`, `job-boards.greenhouse.io` (including the EU sites and forms embedded in a company's own page), `jobs.ashbyhq.com`, `jobs.smartrecruiters.com`, `apply.workable.com`.

On any other site (a company's own careers page), click the extension's icon and choose **Fill this page**.

Tested on live Lever and Greenhouse forms, without submitting. Ashby, SmartRecruiters and Workable use the same general filler but have not been tested on live forms, so expect more fields left for you there.

## Your data

Your details and resume go from your dashboard to the application tab you opened, inside your own browser. They are held in the browser's session storage and cleared when Chrome closes. Nothing is sent anywhere else.

## Using a different dashboard address

The extension talks to the dashboard at `https://job-applier-beta.vercel.app` and to `localhost`. If your dashboard moves, change the first `matches` list in `manifest.json` and reload the extension.
