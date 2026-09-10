JAGS ASSURANCE
Quality Management Platform
QMP INSPECT — AI PROMPTS & OUTPUTS
The real prompts the app uses, and what each produces
For the developer — starting-point prompts to embed and refine
Version 1.1  ·  06 Sep 2026  ·  Confidential
# How To Use This
Your developer asked a good question: not just what the screens look like, but how the AI actually generates output from a prompt. This document answers that directly. For each AI feature it shows: (1) the real prompt to embed in the app, and (2) a realistic example of what the AI returns. These are STARTING-POINT prompts — proven and ready to use, but refine them as you test.
[TABLE]
✓  The two things to understand | The prompt is written ONCE and embedded in the app's code (in the API call to the |   Anthropic Claude API). The user never types it — they click a button. | The app sends: the embedded prompt + the user's content (e.g. the spec text). The AI |   returns structured data (ideally JSON) that the app turns into ITP rows, checklist |   items, etc. Then a qualified person reviews and approves.
[/TABLE]
[TABLE]
ℹ  How the API call works (plain version) | 1. User clicks 'Generate ITP from specification'. | 2. App builds the message: [embedded prompt] + [the spec text from the vault]. | 3. App calls the Anthropic Claude API with that message. | 4. AI returns structured JSON (activities, sections, suggested points). | 5. App renders it as an editable ITP; the user confirms/edits/approves. | Ask Claude Code to 'return the result as JSON in this exact shape' so parsing is reliable.
[/TABLE]
[TABLE]
⚠  Golden rule (applies to every prompt here) | AI DRAFTS — a qualified person reviews, edits and approves. Every prompt ends by | asking for a draft the human will check. The AI never finalises a quality decision.
[/TABLE]
# 1. Spec-to-ITP Generation
The flagship. The user picks a spec from the vault and clicks 'Generate ITP'. The app sends this prompt plus the spec text. The constraints are what keep it from over-building (the problem you found in testing).
[TABLE]
THE PROMPT (embed this in the app)
You are a senior QA/QC engineer preparing an Inspection & Test Plan (ITP). | Read the SPECIFICATION provided and cross-reference the applicable standards | listed. Produce a CONCISE, field-usable ITP — not an exhaustive one. |   | RULES: | - Use ONLY these sections: 1. Submittals & Materials, 2. Installation/Execution, |   3. Testing & Commissioning, 4. Handover. | - Maximum 4-6 activities per section. Combine minor items. | - Include ONLY activities that genuinely need an inspection or test. Skip |   definitions, background and general text. | - For each activity provide: activity, reference (spec clause/standard), |   acceptance_criteria, method, frequency, and a SUGGESTED point type per party |   (contractor, subcontractor, tpi, jags, client) each as H/W/R/S or null. | - Give a one-line reason for each suggested Hold point. |   | Return ONLY valid JSON in this shape (no extra text): | { "sections": [ { "name": "...", "activities": [ { "activity":"...", |   "reference":"...", "acceptance_criteria":"...", "method":"...", |   "frequency":"...", "points": {"contractor":"H","tpi":"W","jags":"R", |   "client":"W","subcontractor":null}, "hold_reason":"..." } ] } ] } |   | APPLICABLE STANDARDS: IEC 60204-1, IEC 60364-5-52, IEC 60364-6, ISO 9001 | SPECIFICATION: | <<< the spec text from the vault is inserted here >>>
[/TABLE]
[TABLE]
EXAMPLE OUTPUT (what the AI returns)
{ "sections": [ |   { "name": "Submittals & Materials", "activities": [ |     { "activity": "Material inspection - cables & accessories", |       "reference": "Elec Spec 6.2 / IEC 60227", |       "acceptance_criteria": "Cables comply with approved schedule; |         certificates of conformance received", |       "method": "Visual + document review", "frequency": "Per delivery", |       "points": {"contractor":"H","tpi":"W","jags":"R","client":"W", |         "subcontractor":null}, "hold_reason":"Verify approved materials |         before installation" } ] }, |   { "name": "Testing & Commissioning", "activities": [ |     { "activity": "Insulation resistance test", |       "reference": "IEC 60364-6", |       "acceptance_criteria": "IR >=100 MOhm at 500V DC, conductor to earth", |       "method": "Megger test", "frequency": "Each circuit", |       "points": {"contractor":"W","tpi":"H","jags":"W","client":null, |         "subcontractor":null}, "hold_reason":null } ] } | ] } |   | -> The app parses this JSON into an editable ITP with the sections, |    activities and per-party intervention chips. The engineer then |    confirms/edits each and approves.
[/TABLE]
[TABLE]
ℹ  Notes for the build | Insert the spec text where marked. Keep the RULES — they prevent the over-building you saw in testing. | Ask for JSON so the app can parse it reliably into ITP rows. | If the spec is long, send only the technical/execution sections, not the whole document. | The suggested points are SUGGESTIONS — the UI must let the engineer confirm/change each.
[/TABLE]
# 2. Checklist Generation (from spec / activity)
Generates a checklist for an ITP activity, at ITP approval. Same pattern: constrained, JSON out, human confirms.
[TABLE]
THE PROMPT (embed this in the app)
You are a QA/QC engineer creating an inspection CHECKLIST for one ITP activity. | Based on the specification extract and the activity, list the specific items an | inspector must check on site. Each item must be answerable Yes / No / N-A. |   | RULES: | - 5-12 items. Concise, specific, field-checkable. No vague items. | - Each item is a single clear check (not a paragraph). | - Mark which items are mandatory. |   | Return ONLY JSON: { "checklist_name":"...", "items":[ {"text":"...", |   "mandatory":true} ] } |   | ACTIVITY: Pre-pour inspection (reinforcement) | SPECIFICATION EXTRACT: <<< inserted here >>>
[/TABLE]
[TABLE]
EXAMPLE OUTPUT (what the AI returns)
{ "checklist_name": "Pre-pour Inspection Checklist", |   "items": [ |     {"text":"Reinforcement cover correct per drawing","mandatory":true}, |     {"text":"Bar sizes and spacing correct","mandatory":true}, |     {"text":"Formwork clean and free of debris","mandatory":true}, |     {"text":"Embedded items in correct position","mandatory":true}, |     {"text":"Concrete delivery ticket checked","mandatory":false} ] } |   | -> The app creates a Yes/No/N-A checklist, numbers it (GFL-JAGS-CHK-001-2.1), |    links it to the activity, and writes the number into Records/Evidence.
[/TABLE]
[TABLE]
ℹ  Notes for the build | Generate at ITP approval so the checklist maps to a final activity and gets a stable number. | The engineer reviews the items before the checklist is saved.
[/TABLE]
# 3. NCR / Observation Drafting
When an inspection fails, the AI drafts clear NCR wording from the inspector's short notes. Saves time; inspector edits and approves.
[TABLE]
THE PROMPT (embed this in the app)
You are a QA/QC engineer writing a Non-Conformance Report (NCR). | From the brief inspection note, the requirement, and the standard, write a | clear, professional, factual NCR description. Be specific and objective; state | what was found vs. what was required. Do not assign blame or speculate. |   | Return ONLY JSON: { "description":"...", "requirement":"...", |   "potential_impact":"..." } |   | INSPECTOR NOTE: cover only 30mm at grid 5, drawing needs 40 | REQUIREMENT: DWG-S-014 Rev A, 40mm +/-5mm cover | STANDARD: ACI 318
[/TABLE]
[TABLE]
EXAMPLE OUTPUT (what the AI returns)
{ "description": "Reinforcement concrete cover measured at 30mm at Grid 5, |    below the specified requirement. Drawing DWG-S-014 Rev A and ACI 318 |    require 40mm (+/-5mm) minimum cover.", |   "requirement": "40mm +/-5mm cover per DWG-S-014 Rev A / ACI 318", |   "potential_impact": "Reduced cover may compromise durability and |    corrosion protection of reinforcement." } |   | -> Pre-fills the NCR form. The inspector reviews, edits and signs.
[/TABLE]
[TABLE]
ℹ  Notes for the build | Keep 'factual, no blame' in the prompt — important for defensible NCRs. | Always editable before submission.
[/TABLE]
# 4. Register Generation (calibration / welder / material)
When the user clicks 'Generate register' on a vault folder, the AI reads the documents and extracts the key data into a structured register. Human confirms the parsed data.
[TABLE]
THE PROMPT (embed this in the app)
You are a QA/QC document controller building a CALIBRATION REGISTER. | From the calibration certificates provided, extract the key data for each | instrument. If a field is not found, use null. Do not invent data. |   | Return ONLY JSON: { "instruments":[ {"instrument":"...","cert_no":"...", |   "cal_date":"YYYY-MM-DD","due_date":"YYYY-MM-DD"} ] } |   | CERTIFICATES: <<< extracted text from the folder documents inserted here >>>
[/TABLE]
[TABLE]
EXAMPLE OUTPUT (what the AI returns)
{ "instruments": [ |    {"instrument":"Megger MIT430 (G-102)","cert_no":"CAL-2291", |     "cal_date":"2026-03-14","due_date":"2027-03-13"}, |    {"instrument":"Torque wrench TW-07","cert_no":"CAL-2288", |     "cal_date":"2025-11-02","due_date":"2026-11-01"} ] } |   | -> The app builds a live Calibration Register, flags items due/overdue by date, |    and uses it to auto-verify instruments referenced in inspections. |    Same pattern for Welder Qualification and Material registers.
[/TABLE]
[TABLE]
ℹ  Notes for the build | 'Do not invent data; use null if not found' is essential — the human confirms parsed values. | The same prompt pattern works for welder qualifications and material submittals — change the fields.
[/TABLE]
# 5. Report Narrative / Summary
Drafts the executive summary or conclusion for a report (e.g. FAT report, monthly pack) from the results. Human edits before it goes in the PDF.
[TABLE]
THE PROMPT (embed this in the app)
You are a QA/QC engineer writing the executive summary of an inspection report. | From the results data, write a concise, professional summary (3-5 sentences): | what was inspected, the overall outcome, and any key findings. Factual and clear. |   | Return plain text only. |   | RESULTS: 18 activities, 16 passed first time, 2 NCRs (1 closed, 1 open), | FAT on crusher model X - conditional pass, 3 punch items.
[/TABLE]
[TABLE]
EXAMPLE OUTPUT (what the AI returns)
The Factory Acceptance Test of Crusher Model X was completed with a | conditional pass. Of 18 inspection activities, 16 passed at first | inspection. Two non-conformances were raised, of which one has been | closed and one remains open. Three punch-list items were recorded for | closure prior to shipment. Overall workmanship and conformance were | satisfactory, subject to closure of the outstanding items. |   | -> Pre-fills the report summary. The engineer edits and approves before issue.
[/TABLE]
[TABLE]
ℹ  Notes for the build | Keep summaries factual. The engineer always edits before the report is issued. | Same pattern for the monthly client pack narrative.
[/TABLE]
# Where the AI Prompts Go (Wiring It In)
This section answers a practical question: once you have these prompts, WHERE do they go in the app? Written plainly so there is no guesswork.
[TABLE]
✓  The easiest way — let Claude Code do the wiring | You do NOT have to figure out the plumbing yourself. When you build a feature in | Claude Code, give it the prompt as part of the request. For example: | 'Add a Generate ITP feature: a button on the ITP page that sends the project's |  specification text to the Anthropic Claude API using THIS prompt [paste the |  Spec-to-ITP prompt], asks for JSON in the shape shown, and displays the result |  as an editable ITP table. Store the API key as an environment variable.' | Claude Code then writes the code AND puts the prompt in the right place.
[/TABLE]
### What's actually happening (so you understand it)
- The prompt lives in the BACKEND code — inside the function that handles the button (e.g. the /api/itp/generate endpoint), not in the browser/frontend.
- That backend function builds the message = [the embedded prompt] + [the user's content, e.g. the spec text] and sends it to the Anthropic Claude API.
- The API returns JSON; the backend passes it to the frontend, which renders the editable result (ITP, checklist, etc.).
- Keep all the prompts together in ONE place (e.g. a prompts.js / prompts.py file or a config), so they're easy to find and refine later — don't scatter them.
- The Anthropic API key is stored as an ENVIRONMENT VARIABLE (a secure setting), never written in the code and never shown in the app.
[TABLE]
ℹ  The tool: Claude Code (not Cowork) | Build the application in Claude Code — the agentic coding tool that writes and edits | the app's files. (Cowork is for knowledge-work tasks, not building software.) | You build the app from the Requirements document; you embed these prompts as you | build each AI feature, by giving the prompt to Claude Code as part of the request.
[/TABLE]
[TABLE]
⚠  Two rules when wiring in any AI prompt | Ask Claude Code to return the result as JSON in the exact shape shown here — so the |   app can parse it reliably into the UI. | The API key goes in an environment variable. If the key is missing, the AI button |   must hide cleanly and the manual tools still work (this is in the Requirements).
[/TABLE]
# Putting It Together
[TABLE]
✓  What the developer does with these | Embed each prompt in the relevant API call to the Anthropic Claude API. | Insert the user's content (spec text, notes, certificate text) where marked. | Ask for JSON (as shown) so the app parses results reliably into the UI. | Render the result as editable, marked 'AI-drafted', and require human approval. | Refine the prompts as you test with real Jags specs — these are starting points.
[/TABLE]
[TABLE]
ℹ  Proving it before building (what to show) | To see it work today: paste one of these prompts + a real spec into Claude and | look at the output. That proves the capability. Then build a one-day proof-of- | concept: a text box -> one API call with the embedded prompt -> show the JSON. | That proves the integration. Then build the full feature.
[/TABLE]
[TABLE]
⚠  The bar to aim for | Not a perfect ITP or NCR — a strong, structured, EDITABLE draft that saves hours. | A qualified person always confirms. That is what makes it valuable and defensible.
[/TABLE]
JAGS ASSURANCE  ·  jagsassurance.com