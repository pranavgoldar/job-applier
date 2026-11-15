# Optional Chrome preparation extension

This is a small, user-triggered form preparation adapter. It is not installed automatically and cannot submit an application.

1. Open `chrome://extensions`, enable Developer mode and select Load unpacked.
2. Select the delivered `extension/` directory.
3. In Career OS, prepare the job, review the exact resume, then choose Export private browser handoff in its answer packet.
4. Open the employer application. Sign in or complete verification yourself.
5. Open the extension, select that private JSON packet, verify the displayed employer/role/resume, and click Fill supported fields.
6. Read the Completed and Remaining sections. Review the actual employer form and verify the resume upload was accepted. Copy any custom answers from the dashboard and make your own declarations.
7. Click final submit yourself. Save credible confirmation, then mark the application user-confirmed in Career OS. Delete the exported packet when done.

Supported host boundaries: `jobs.lever.co`, `boards.greenhouse.io`, `job-boards.greenhouse.io`, `jobs.ashbyhq.com`. The page must match the packet's exact application path (or its `/apply` child). Known selectors support first/last/full name, email, phone and explicitly named resume upload inputs. Existing conflicting text is preserved. Unsupported/custom/dynamic fields remain manual. Some ATS forms will match no selectors; the extension reports that honestly.

The extension has activeTab and scripting permissions only, no persistent employer host access and no account credentials. Resume bytes travel only through the private exported packet and the user-selected employer tab. The stored checksum is checked before assigning the file input. A file assignment is not a confirmed employer upload. It does not fill consent checkboxes, legal declarations, eligibility claims, salary questions or assessments, and never clicks buttons.

It keeps no secure browser session. Your own employer session remains in Chrome. The dashboard does not receive the extension's fill report automatically; it continues to say no fields were filled by the dashboard. Test coverage exercises partial fill and wrong-role/host rejection in a DOM environment. Live employer browser verification was unavailable, so treat the selectors as preliminary and check every result.
