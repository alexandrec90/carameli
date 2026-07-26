# TODO

## Architecture & Docs

* [ ] is license cost included in price chart?

## AI / Agent Workflow

* [ ] Run promptfoo eval JUST on fix tests
* [ ] Install gemini and codex cli - gemini flash has generous free tier that could be used with promptfoo!

## Infrastructure & DevOps

* [ ] Github actions after deployment - production environment + CD workflow + OIDC + secret scanning
* [X] ~~*gh secret/vars + a sandbox environment → one manually-dispatched paid/sandbox test workflow*~~ [2026-07-16]
* [X] ~~*CI tests temporarily disabled: pr-gate.yml (re-enabled — fires on PR to master), nightly.yml + weekly.yml (re-enabled schedules)*~~ [2026-07-14] → `/fix-workflows` skill (renamed from `/fix-scheduled` 2026-07-16) drives failing workflow runs back to green

## Testing & Integration

* [ ] run ngrok and run associated tests
* [ ] Set up and test VANILLASOFT_WEBHOOK_URL
* [X] ~~*re-enable github actions: "Rename-Item .git/hooks/pre-commit.disabled pre-commit" and "Rename-Item .github/workflows/ci.yml.disabled ci.yml*~~ [2026-07-14]
Rename-Item .github/workflows/e2e-smoke.yml.disabled e2e-smoke.yml
git add .github/workflows/
git commit -m "chore: re-enable CI workflows"
git push" and "Rename-Item .git/hooks/pre-push.disabled pre-push"
* [X] ~~*asyncpg.exceptions.InvalidPasswordError: password authentication failed for user "carameli"*~~ [2026-07-16]
* [ ] Test: Run Load (Locust) (performance)
* [ ] Test: Run Mutation (mutmut) (mutation score)
* [X] ~~*Separate paid and free tests*~~ [2026-07-14]

## UI / Frontend

* [ ] make panels wrappable when page is resized
* [ ] also play with "speed/action lines", radial sunburst lines instead of dots
* [ ] backgrounds also don't need to be solid white - you could have light blue background with dark blue dots
* [ ] ui performance issues
* [ ] loading screen shouldn't "flash" for quick loads, it's jarring
* [ ] scrape metadata from images
* [ ] maybe add tests to check if ui components/images are properly compressed - maybe test for performance bottlenecks?
* [ ] make transitions slower so I can actually see it

## Done

* [X] ~~*Run fix all skill*~~ [2026-07-10]
* [X] ~~*set TELNYX_SANDBOX=1 to test telnyx*~~ [2026-07-10]
* [X] ~~*Test: Run pytest (backend pytest tests)*~~ [2026-07-10]
* [X] ~~*Test: Run Frontend (Vitest)*~~ [2026-07-10]
* [X] ~~*Test: Run E2E (headless) (or Test: Run E2E (cross-browser))*~~ [2026-07-10]
* [X] ~~*Test: Run Telnyx Sandbox (only when sandbox creds are configured)*~~ [2026-07-10]
* [X] ~~*Figure out ui transitions - ben day dot ripple from corner, washing away content?*~~ [2026-07-10]
* [X] ~~*remove page misregistration transitions*~~ [2026-07-10]
* [X] ~~*UI components: images/characters (nested inside panels), panel layout, ben-day dot backgrounds, speech bubbles*~~ [2026-07-10]
* [X] ~~*add "gradient" effect to ben-day dot backgrounds (dot density can vary throughout panel)*~~ [2026-07-10]
* [X] ~~*logo top left should be smaller - panel can taper up toward top left not to squeeze other panels*~~ [2026-07-10]
* [X] ~~*figure out a way to easily move/scale images in panels - make editor!*~~ [2026-07-10]
* [X] ~~*check cloudli UI against what's implemented*~~ [2026-06-24]
* [X] ~~*I want to keep a closer eye on fixer performance - is all agent activity tracked? Token cost, tool calls, etc. Should I also keep timestamped error logs for reference?*~~ [2026-06-27]
* [X] ~~*add an argument to fixers to disambiguate between mobile and desktop*~~ [2026-06-27]
* [X] ~~*add a test for argument-less fixer determining whether they're running on mobile or desktop*~~ [2026-06-27]
* [X] ~~*Postgres extension - why is server still listed as "voicegateway"?*~~ [2026-07-07]
* [X] ~~*come up with comprehensive checklist of things you still need like run ngrok, set up telnyx, get phone numbers, plug vanillaland endpoints, etc. - mostly to set up more tests*~~ [2026-07-03] → see docs/prototype-roadmap.md (Workstream C + milestones)
* [X] ~~*Test: Run E2E (headless) output isn't standard relative to others - also make sure all test output is standard - minimal terminal noise, filtered, actionable output to artifact file. Also update corresponding fixer skill.*~~ [2026-06-25]
* [X] ~~*run docs/plans/ a and b*~~ [2026-06-25]
* [X] ~~*Come up with claude skill or agent to just break things down into implementation plan to save on tokens then use copilot to implement. Way too costly for claude to implement stuff.*~~ [2026-05-22]
* [X] ~~*skill to fix known vibe coded design flaws*~~ [2026-04-28]
* [X] ~~*use frontmatter hooks to trigger hooks instead*~~ [2026-04-30]
* [X] ~~*Check if existing scripts in skills should be run through hooks instead*~~ [2026-04-30]
* [X] ~~*remove inline ! commands*~~ [2026-05-22]
* [X] ~~*remove frontmatter hooks*~~ [2026-05-22]
* [X] ~~*byte-capping pre-tool hook - could that save tokens?*~~ [2026-05-22]
* [X] ~~*understand why state.json are not all file scoped*~~ [2026-06-24]
* [X] ~~*Any way to also normalize known-fixes.md with hooks?*~~ [2026-06-24]
* [X] ~~*run skill to fix vibe coded design flaws*~~ [2026-06-24]
* [X] ~~*check for mentions of bash - should use powershell*~~ [2026-06-24]
* [X] ~~*there should be a task that runs all tests? is there already?*~~ [2026-06-24]
* [X] ~~*remove all PS1 references/constraints*~~ [2026-06-24]
* [X] ~~*do skill workflows involve tasks at all? or running scripts? are they optimal?*~~ [2026-06-24]
* [X] ~~*revisit task first architecture - is coding agent ever instructed to only operate through tasks? is that really most efficient?*~~ [2026-06-24]
* [X] ~~*extend coding agent logging to copilot*~~ [2026-04-20]
* [X] ~~*check copilot/claude "warning from stop hook" "C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\python3.exe: can't open file 'C:\\c\\Users\\Administrator\\Desktop\\vs_code\\carameli\\scripts\\hooks\\archive-session.py': [Errno 2] No such file or directory"*~~ [2026-04-19]
* [X] ~~*run e2e/ci tests locally*~~ [2026-04-19]
* [X] ~~*Linting, docker status, unit tests, integration tests, e2e headless, e2e headed, ci tests, runtime logs*~~ [2026-04-19]
* [X] ~~*UI design workflow*~~ [2026-04-19]
* [X] ~~*Should there be a source of truth for architecture or is that redundant with folder structure and requirements file? I need to update charts, claude.md, possibly claude skills/rules, possibly ignore (docker and claude), requirements.txt (both dev and regular), readme, extensions.json, package.json.*~~ [2026-04-16]
* [X] ~~*Make sure md files don't have styling guidelines - that should be handled by linters*~~ [2026-04-16]
* [X] ~~*the --reload flag in the CMD on line 27 is also dev-only, but that's typically overridden in production compose/orchestration in dockerfile*~~ [2026-04-16]
* [X] ~~*Flickering candlelit, glass UI*~~ [2026-02-21]
* [X] ~~*Yaml linting? What other linting am I missing?*~~ [2026-02-21]
* [X] ~~*Test linting*~~ [2026-02-21]
* [X] ~~*Test debugging*~~ [2026-03-08]
* [X] ~~*Custom prompt to debug*~~ [2026-02-21]
* [X] ~~*Custom prompt to fix problems*~~ [2026-02-21]
* [X] ~~*Integrate into Vanillasoft*~~ [2026-04-05]
* [X] ~~*Deploy to ngrok so it's accessible to Vanillasoft*~~ [2026-04-05]
* [X] ~~*Make it easy to switch underlying provider - vonage, twilio (can multiple be implemented at once as fallback?)*~~ [2026-03-08]
* [X] ~~*Can I test UI without launching whole process? Just to see what it looks like live, while making changes?*~~ [2026-02-21]
* [X] ~~*useless md rules referenced in copilot - why?*~~ [2026-02-21]
* [X] ~~*does it still ask to configure formatter?*~~ [2026-03-08]
* [X] ~~*cappucino streaks ui*~~ [2026-02-21]
* [X] ~~*make scrollbar blend*~~ [2026-02-21]
* [X] ~~*refactor index.css*~~ [2026-02-21]
* [X] ~~*Axe gemini what it thinks about ui*~~ [2026-03-01]
* [X] ~~*Remove blue text highlighting*~~ [2026-02-21]
* [X] ~~*React three fiber - revisit this later*~~ [2026-04-05]
* [X] ~~*Claude rules-  why are they always referenced in copilot*~~ [2026-02-22]
* [X] ~~*Do Claude skills need more resources?*~~ [2026-03-01]
* [X] ~~*Load up vanillaland locally*~~ [2026-03-01]
* [X] ~~*Full refactor skill (only files with new commits)*~~ [2026-03-01]
* [X] ~~*Tasks - is there a point to having separate ts and js linting?*~~ [2026-03-01]
* [X] ~~*Refactor claude commands to skills*~~ [2026-03-01]
* [X] ~~*Is notif complaining about python venv still there?*~~ [2026-03-08]
* [X] ~~*Check out new skin*~~ [2026-04-05]
* [X] ~~*eliminate twilio*~~ [2026-03-08]
* [X] ~~*eliminate voicegateway*~~ [2026-03-08]
* [X] ~~*Illustrate architecture*~~ [2026-03-08]
* [X] ~~*automated tests*~~ [2026-03-09]
* [X] ~~*set up proof of concept*~~ [2026-04-05]
* [X] ~~*stack audit*~~ [2026-03-09]
* [X] ~~*other test lines of defense?*~~ [2026-03-09]
* [X] ~~*skill to make unit tests*~~ [2026-03-09]
* [X] ~~*get list of cloudli features*~~ [2026-03-10]
* [X] ~~*compare cloudli features to carameli - how much would difference cost?*~~ [2026-03-10]
* [X] ~~*have ai check vanillasoft to see if everything from cloudli is available in carameli*~~ [2026-03-10]
* [X] ~~*review skill stack*~~ [2026-03-10]
* [X] ~~*architecture review skill*~~ [2026-03-10]
* [X] ~~*Should review skill only review?*~~ [2026-03-10]
* [X] ~~*hooks? are they useful here?*~~ [2026-03-11]
* [X] ~~*are runtime errors all logged and ai-accessible?*~~ [2026-03-10]
* [X] ~~*Make chart to illustrate architecture - with layman descriptions of what parts do*~~ [2026-03-10]
* [X] ~~*Make chart illustrating "meta" coding architecture - linting, tests, skills, hooks, etc.*~~ [2026-03-10]
* [X] ~~*Make chart illustrating costs - for 1e3,1e5,1e7,1e9 volumes*~~ [2026-03-10]
* [X] ~~*have ai implement features in cloudli, not carameli and needed by vanillasoft*~~ [2026-04-05]
* [X] ~~*fix pre-commit pipeline*~~ [2026-03-24]
* [X] ~~*fix tests too*~~ [2026-03-14]
* [X] ~~*Does using commands as skills pollute context window unnecessarily?*~~ [2026-03-11]
* [X] ~~*Too much info in claude.md?*~~ [2026-03-11]
* [X] ~~*somehow improve linting/unit test/debug pipeline to AI*~~ [2026-03-14]
* [X] ~~*Mobileness*~~ [2026-03-14]
* [X] ~~*carameli.log gets way too long*~~ [2026-03-14]
* [X] ~~*Is it possible for tasks to either end with red x, yellow warning, or green pass but avoid spinning indefinitely or closing terminal automatically?*~~ [2026-03-14]
* [X] ~~*separate task to extract actionable warnings/errors from carameli.log*~~ [2026-03-14]
* [X] ~~*Make pytest a little more verbose instead of stalling in "Running pytest (unit + integration).." so long BUT errors shouldn't be dumped into terminal either*~~ [2026-03-14]
* [X] ~~*should fix-all autonomously rerun corresponding task? should it be 3 different skills?*~~ [2026-03-14]
* [X] ~~*what's folder "tls" for?*~~ [2026-03-17]
* [X] ~~*task notifs still don't work*~~ [2026-03-17]
* [X] ~~*why are precommit and linting different?*~~ [2026-03-18]
* [X] ~~*do tests have to run in docker? is it just a library thing?*~~ [2026-03-18]
* [X] ~~*VITE_API_KEY not hidden in prod*~~ [2026-03-23]
* [X] ~~*sync remote with newly gitignored files*~~ [2026-03-19]
* [X] ~~*set up repo at home too*~~ [2026-03-19]
* [X] ~~*also git ignore workspace*~~ [2026-03-19]
* [X] ~~*undo claude cargo pre-commit change*~~ [2026-03-19]
* [X] ~~*set up telnyx and jambonz integration tests - are there other candidates for tests? other free accounts I could set up?*~~ [2026-03-20]
* [X] ~~*investigate failed github tests (email)*~~ [2026-03-24]
* [X] ~~*pipe smoke test (github) outputs to log for coding agent*~~ [2026-03-24]
* [X] ~~*get missing env variables to set up more integration tests*~~ [2026-03-20]
* [X] ~~*what are ENCRYPTION_SECRET and JWT_SECRET for? - for jambonz*~~ [2026-03-23]
* [X] ~~*should skills be agents instead?*~~ [2026-03-20]
* [X] ~~*can pre-commit stage autofixed changes?*~~ [2026-03-23]
* [X] ~~*alembic linting*~~ [2026-03-24]
* [X] ~~*add PSScriptAnalyzer to linting*~~ [2026-03-24]
* [X] ~~*is github deploy pipeline an alternative to azure devops?*~~ [2026-03-24]
* [X] ~~*auto fixer should restart docker*~~ [2026-04-06]
* [X] ~~*make panel line separators sexier*~~ [2026-04-06]
* [X] ~~*images distort on page refresh*~~ [2026-04-06]
* [X] ~~*add speech bubbles on hover indicating menu name*~~ [2026-04-07]
* [X] ~~*logo should also only colorize on hover*~~ [2026-04-06]
* [X] ~~*react changes don't take effect unless I restart docker - why?*~~ [2026-04-06]
* [X] ~~*orange "loading" screen should be removed*~~ [2026-04-07]
