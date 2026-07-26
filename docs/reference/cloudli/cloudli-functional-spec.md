# Cloudli — Functional Spec (auto-generated baseline)

_Source: cloudli_features_2026-06-24.json (scraped 2026-06-24). One section per page. Use to diff against Carameli._

## Navigation / Sitemap

Cloudli exposes **39** account-scoped pages. Menu items:

- Users
- Subscriptions
- Subscriptions Logs
- Tokens
- Webhooks
- Call Screening
- Contacts
- Groups - Contacts
- Devices
- Call Parking
- Exemption codes
- Expansion module
- Extensions
- Grouped extensions
- Intercom
- Multicast Intercom
- Menus - Components
- Multicast Voicemail
- Mailbox drop
- Messages/Advertisements
- Music
- Music on hold
- Numbers
- Permanent Conferences
- Prompts
- Console
- Parameters
- SMS Number
- Speed Dials
- Voicemail
- Call Statistics
- Summary - Extension (Date)
- Summary - Extension (Period)
- Summary - Phone Number (Date)
- Summary - Phone Number (Period)
- Agents
- Queues
- Skills

## 1. Users — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Users
- **Purpose:** Organizational User Management.
- **Actions:** NEW, (icon: search)
- **Filters:** text search
- **Table** (25 rows): Last Name, First Name, Addresses, Telephones, Emails, Text messaging number, User, Id Number, Admin — sortable
- **Form fields:** Search (search); 10 25 50 100 per page [10, 25, 50, 100]

## 2. Subscription (API) — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Subscription (API) › API Subscription Logs
- **Purpose:** Subscription to an event to receive its content at a given URI.
- **Actions:** Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): ID, Person, Event, Method, URI

## 3. Subscription (API) — `SubscriptionEventTransmitterLogs`

- **Breadcrumb:** fab test S1 › Subscription (API) › API Subscription Logs
- **Purpose:** This report generates the list of API events passed to subscriptions during the selected period.
- **Actions:** Generate, Abort, Export, Print
- **Filters:** text search, date range (2 date field(s))
- **Table** (3 rows): #, Date, Subscription, Event, Target, Success — sortable
- **Form fields:** `Start[0][Date]` (hidden); `End[0][Date]` (hidden)

## 4. API login token — `WebSimpleList`

- **Breadcrumb:** fab test S1 › API login token › Access Logs (API tokens)
- **Purpose:** Log in token for phone API
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): Token, Enabled, Last date used

## 5. Webhook — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Webhook
- **Purpose:** Management of webhooks configuration
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (4 rows): Description, Events

## 6. Call Screening — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Call Screening
- **Purpose:** Avoid unwanted calls.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): Justification, Number, Action

## 7. Contacts — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Contacts
- **Purpose:** Contacts
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): Last Name, First Name, Company, Function

## 8. Contact Groups — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Contact Groups
- **Purpose:** Contact Groups
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search

## 9. Telephone devices — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Telephone devices › IP provisioning
- **Purpose:** Telephones
- **Actions:** Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): MAC address, Model, Extensions, Last provisioning date, IP address where last seen, Monitor link quality, Firmware version, ID

## 10. Call Parking — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Call Parking
- **Purpose:** This type of extension allows you to park call to the extension.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): ID, Description, Extension, Ring back Time Limit

## 11. Exemption codes — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Exemption codes
- **Purpose:** The code allows the exemption of call restrictions configured at the account or telephone extension level.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (1 rows): Description, Exemption Code, Call Restrictions

## 12. Extension module — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Extension module
- **Purpose:** Extension modules for receptionists
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): Description, Brand, Model, ID

## 13. Extension — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Extension › Activate Cloudli Connect App › GlobalJournal › Console settings › Detailed calls log (By Period) › Microsoft Teams Provisioning
- **Purpose:** Management of extensions linked to devices whose provisioning is pushed by Cloudli.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (46 rows): Extension Number, User, Type, Device, Status, Notes, Monitor device connection, Call recording, Last seen

## 14. Group Extension — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Group Extension
- **Purpose:** Manage Group Extensions.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): Description, Number, Subscribed Extensions

## 15. Intercom Extension — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Intercom Extension
- **Purpose:** All subscriber extensions will receive calls on the speaker of their device.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): Number, Description, Subscriber Extensions, Bidirectional Audio, Expiry

## 16. Intercom Extension - Multi-cast — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Intercom Extension - Multi-cast
- **Purpose:** The multi-cast intercom extension allows broadcasting from a transmitting telephone set (single source) to a group of subscriber extensions.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): Extension, Description, Extensions, Users

## 17. Menu Component — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Menu Component
- **Purpose:** Components allowing the user to build a menu from smaller, more manageable, pieces.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (2 rows): Name

## 18. Voicemail - Broadcast — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Voicemail - Broadcast
- **Purpose:** This voicemail allows you to record and broadcast the recorded messages to each subscriber voicemail.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): Number

## 19. Mailbox Drop — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Mailbox Drop
- **Purpose:** During an ongoing call, you can use this dynamic feature to play a pre-recorded audio message (File), it will be played when silence is detected.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search

## 20. Advertising — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Advertising
- **Purpose:** Bank of advertising to broadcast a call waiting caller.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): Description, Text, ID

## 21. Music tracks — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Music tracks
- **Purpose:** Bank for musical tracks to be broadcast to a caller waiting on the telephone.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (2 rows): Title

## 22. Custom on hold — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Custom on hold
- **Purpose:** Management of the mix of music tracks and advertising tracks to play when a caller is on hold.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): ID, Description, Default, Musical tracks, Promotional messages

## 23. VoIP Number — `WebSimpleList`

- **Breadcrumb:** fab test S1 › VoIP Number
- **Purpose:** Management of phone numbers.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (29 rows): Telephone Number, Notes, Action, 911 address, Default Language, Filter callerid

## 24. Telephone conferences — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Telephone conferences
- **Purpose:** Management of permanent telephone conferences.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): Number, Maximum Participants, Recorded Calls

## 25. Prompts — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Prompts
- **Purpose:** Management of prompt messages used in interactive phone menus and for phone campaigns.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): Name, Length (sec), Description, Languages, #

## 26. Extension — `ConsoleSettings`

- **Breadcrumb:** fab test S1 › Extension › GlobalJournal › Console settings › Detailed calls log (By Period) › Zoho journal
- **Purpose:** You do not have an extension.
- **Actions:** NEW
- **Filters:** text search

## 27. SMS Numbers — `WebSimpleList`

- **Breadcrumb:** fab test S1 › SMS Numbers
- **Purpose:** Activate SMS in CloudliApps
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (19 rows): Telephone number, Cloudli App Users, Recipients ( Email )

## 28. Speed dials — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Speed dials
- **Purpose:** The SpeedDial feature permit you to dial *75 followed by a two digit number (00 to 99) instead of the full telephone number.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (2 rows): Code, Phone number, Description

## 29. Voicemail — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Voicemail › Mass Creation
- **Purpose:** Voicemail management associated to extensions.
- **Actions:** NEW, Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (18 rows): Extension, User, Days before auto-delete, New messages

## 30. Extension — `CDRDashboard`

- **Breadcrumb:** Extension
- **Purpose:** Report - Call StatisticsStart
- **Actions:** Generate, Cancel
- **Filters:** text search, date range (1 date field(s))
- **Form fields:** `Start[0][Date]` (hidden)

## 31. Extension — `GroupCDRReport`

- **Breadcrumb:** Extension
- **Purpose:** Detailed call logSelect the desired date
- **Actions:** Generate, Cancel
- **Filters:** text search, date range (1 date field(s))
- **Form fields:** `Start[0][Date]` (hidden)

## 32. Extension — `GroupCDRPeriod`

- **Breadcrumb:** Extension
- **Purpose:** Detailed calls log (By Period)BeginningEnd
- **Actions:** Generate, Cancel
- **Filters:** text search, date range (2 date field(s))
- **Form fields:** `Start[0][Date]` (hidden); `End[0][Date]` (hidden)

## 33. VoIP Number — `CDRReport`

- **Breadcrumb:** VoIP Number
- **Purpose:** Calls log per phone numberSelect the desired date
- **Actions:** Generate, Cancel
- **Filters:** text search, date range (1 date field(s))
- **Form fields:** `Start[0][Date]` (hidden)

## 34. VoIP Number — `CDRPeriod`

- **Breadcrumb:** VoIP Number
- **Purpose:** Calls journal per phone number (By Period)Beginning End
- **Actions:** Generate, Cancel
- **Filters:** text search, date range (2 date field(s))
- **Form fields:** `Start[0][Date]` (hidden); `End[0][Date]` (hidden)

## 35. Agents — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Agents
- **Purpose:** Call centre agents management.
- **Actions:** Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): Agent, Extension, Status, Skills, Device, Permanent Recording

## 36. Call Queue — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Call Queue
- **Purpose:** Call queue management for incoming calls by a phone number or IVR.
- **Actions:** Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): Number, Name, Strategy, Skills, Agents

## 37. Skills of agents — `WebSimpleList`

- **Breadcrumb:** fab test S1 › Skills of agents
- **Purpose:** Management of the different skills of agents.
- **Actions:** Search Clear, Search, Clear, Export
- **Filters:** text search
- **Table** (0 rows): Skill, Help
