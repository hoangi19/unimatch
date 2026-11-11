# Meta App Review

What the owner needs to submit App Review for app `uniagent` (`1781999639695661`), so that people who are
not app testers can message a connected Page and get answers. The owner submits; nothing here changes Meta
app settings by itself. Owner steps are tracked in #33.

Public pages (no sign-in), live once `main` is deployed:

- Privacy policy: `https://unimatch-1va.pages.dev/privacy`
- Data deletion instructions: `https://unimatch-1va.pages.dev/data-deletion`

Both are in Vietnamese by default with an English switch (top right). Their text is in `web/src/i18n/*.ts`
under `legal.*` and must stay in line with what the app stores. It is a factual description of the
current app, not legal advice.

## Before submitting

1. Replace the contact email placeholder: set `CONTACT_EMAIL` in `web/src/Legal.tsx` (it shows as
   `[OWNER CONTACT EMAIL]` on both pages), merge and deploy. Meta rejects a policy without a working contact.
2. Open both URLs in a private window and check they load without signing in.
3. Make sure the flows below work on the live app with the UniMatch Page connected (#14, #22, #27).

## App Dashboard checklist

| Where | Field | Value |
|-------|-------|-------|
| App settings → Basic | Privacy Policy URL | `https://unimatch-1va.pages.dev/privacy` |
| App settings → Basic | User data deletion | "Data deletion instructions URL": `https://unimatch-1va.pages.dev/data-deletion` |
| App settings → Basic | App icon | 1024 × 1024 PNG. Export the logo from `web/public/favicon.svg`. |
| App settings → Basic | Category | Business and pages (or Messaging) |
| App settings → Basic | Contact email | The same address as on the pages |
| App settings → Basic | App domains | `unimatch-1va.pages.dev` |
| Settings → Business verification | Business Verification | Required for Advanced Access to Page permissions. Needs the business's legal documents. |
| App Review → Permissions and features | Request Advanced Access | `pages_show_list`, `pages_messaging`, `pages_manage_metadata` |
| App Review → Requests | Test credentials | See below |
| App mode | Live | Switch only after the review is approved |

## Permissions

The app uses only these three. Paste each text into its "How will your app use this permission?" box.

### `pages_show_list`

> UniMatch is an admin console that lets a Page's staff answer Messenger questions from job seekers with
> an AI assistant. When a staff member clicks "Connect a Page" in the console, they log in with Facebook and
> the app calls `/me/accounts` to list the Pages they manage, with their names, pictures and tasks. The
> staff member picks which Pages to connect. We use the list only to show this choice and to check that
> the person has messaging rights on the chosen Page. We do not store Pages that were not chosen.

### `pages_messaging`

> UniMatch answers messages that people send to a connected Page. Messenger webhooks deliver each message
> to our server, which stores the conversation for the Page's staff and replies automatically with an AI
> model that follows the Page's own instructions. Staff can also read the conversation in the console, take
> over from the bot and reply by hand. We only reply to people who wrote to the Page first, only within
> the 24-hour messaging window, and we never send promotional or unsolicited messages.

### `pages_manage_metadata`

> When a staff member connects a Page, UniMatch subscribes the app to that Page's Messenger webhooks
> (`POST /{page-id}/subscribed_apps` with `messages`, `messaging_postbacks`, `message_echoes`,
> `message_deliveries`, `message_reads`) so new messages reach the assistant. When the Page is
> disconnected, the app removes the subscription (`DELETE /{page-id}/subscribed_apps`). We use this
> permission for nothing else.

## Screencast script

Record one video per permission (or one video with chapters), 1080p, English UI (EN switch), with the
mouse visible. Meta wants to see the Facebook login, the permission being used, and its effect. Show the
whole flow without cuts where possible. Use a test customer account that is a tester of the app.

1. **Sign in.** Open `https://unimatch-1va.pages.dev`, sign in with the review account. Show the Inbox.
2. **`pages_show_list`.** Open the "Facebook Pages" tab and click "Connect a Page". The Facebook login popup
   opens: show the permissions dialog and approve. Back in the modal, show the list of Pages and select
   the UniMatch Page, then confirm. The Page card shows "Connected".
3. **`pages_manage_metadata`.** On the same tab, show the webhook panel's "Subscribed fields" list. Say (caption): "Connecting subscribed the app to this Page's message webhooks."
4. **`pages_messaging`, receive and auto-reply.** In a second window, signed in as the test customer,
   open `https://www.facebook.com/messages/t/1531275346725506` and send "Do you have data jobs in Ho Chi
   Minh City?". Show the bot reply arriving in Messenger. Switch to the console: the conversation appears
   in the Inbox in real time with both messages.
5. **`pages_messaging`, human reply.** In the conversation, click "Take over", type a reply and send it.
   Show it arriving in the customer's Messenger. Click "Return to bot".
6. **Disconnect (optional).** On the Page card, click "Disconnect" to show the subscription being removed.
7. **Privacy.** Open `/privacy` and `/data-deletion` to show the policy and how to delete data.

## Test credentials

Reviewers need an admin login for the console. The owner creates a dedicated review admin account (not a
personal one) and enters its email and password only in the App Review form's test instructions box.
Never commit them to the repo or paste them in an issue. Suggested instructions text:

> Sign in at https://unimatch-1va.pages.dev with the credentials below. The UniMatch Page is already
> connected. To test messaging, message the Page "UniMatch - Giải pháp hỗ trợ sinh viên tìm việc làm" from
> any Facebook account; the reply arrives within a few seconds and the conversation appears in the Inbox.

Disable or delete the review account once the review is approved.

## Data deletion runbook

Customers ask through one of the two channels on `/data-deletion`: a Messenger message to the Page
("Delete my data" / "Xoá dữ liệu của tôi") or an email to the contact address. Handle each request
within 30 days.

1. **Find the customer.** In the console Inbox, open the customer's conversation (search by name or by
   the request message). Their PSID is the `psid` of that conversation. To look it up in the SQL editor:

   ```sql
   select page_id, psid, customer_name, last_message_preview, last_message_at
   from public.conversations
   order by last_message_at desc nulls last
   limit 50;
   ```

   For an email request with no matching conversation, reply that nothing is stored.
2. **Confirm first, then delete.** For a Messenger request, reply in that conversation that the data
   will be deleted now; any reply sent after the deletion creates a new conversation. For an email
   request, reply by email after step 3.
3. **Delete.** In Supabase Dashboard → SQL editor (project `hsuxhzalvshmbmiuyhwl`), run:

   ```sql
   select public.delete_customer_data('<psid>');
   ```

   It returns the deleted counts, for example `{"conversations": 1, "messages": 14, "webhook_events": 15}`.
   It deletes, on every Page: the customer's conversations (with notes and status), every message in them
   (with bot reply traces), and the raw webhook events where the customer is the sender or the recipient.
   The function runs only as `postgres` or the service role; admins in the console cannot call it.
4. **Check.** Run it again: every count is 0.
5. **Record.** Note the date and the counts (not the PSID or name) wherever the owner keeps request records.

The copy of the conversation in Meta's Page inbox and the customer's Messenger is kept by Meta; the pages
say so.
