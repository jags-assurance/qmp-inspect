<div class="cover">
<div class="kicker">JAGS ASSURANCE · QMP INSPECT</div>
<h1 class="covertitle">The Complete Easy Guide</h1>
<p class="coversub">From free sign-up to paid subscriptions, handover and daily running. Written in plain words, with simple steps and a worked example.</p>
<table class="meta">
<tr><td>Who is it for</td><td>The client owner, the client's IT helper, and the developer. No technical background needed for Parts 1 to 6.</td></tr>
<tr><td>What it covers</td><td>What each service is, why we start free, when to pay, how to create each account, how to set up the system, how to hand it over, and how to keep it healthy.</td></tr>
<tr><td>Prices</td><td>Approximate, in US dollars per month. They change, so confirm on each company's website before paying.</td></tr>
</table>
</div>
<div class="pagebreak"></div>

# Contents

1. The big picture in plain words
2. Why we start free, and when we pay
3. The six services, one by one
4. A worked example: "Acme Engineering"
5. Step-by-step: create each account
6. Step-by-step: set up the system
7. Checking that everything works
8. Handing over to the client
9. Keeping it healthy after handover
10. Common problems and simple fixes
11. Questions people ask
12. Words explained simply

<div class="pagebreak"></div>

# 1. The big picture in plain words

QMP Inspect is a website where inspectors, contractors and clients record inspections, sign things off, raise problems (called NCRs) and produce reports and PDFs for a project.

Think of it like opening a shop:

| Part of the shop | The service that does it | What it does in plain words |
|---|---|---|
| The street address | **Cloudflare** (the domain) | The web address people type, for example `qmp.acmeqa.com` |
| The shop front | **Vercel** | The website people see and click |
| The storeroom and records | **Supabase** | Keeps all the data, the logins and the photos safely |
| The back-office printer | **Railway** | Builds the PDFs and runs automatic reminders |
| The postman | **Resend** | Sends the emails, such as "please sign this" |
| The filing cabinet for the plans | **GitHub** | Keeps the code that makes the website work |
| The management reports | **Power BI** | Turns the data into charts for managers |

<div class="tip"><b>Most important idea:</b> every one of these accounts should belong to the <b>client</b>, not to the developer. The developer is only invited in to help. That way the client always keeps control of their own system.</div>

# 2. Why we start free, and when we pay

## Why start with the free plans

1. **No money is spent until the system is ready.** Setting up and testing can take weeks. There is no point paying every month while nothing is live.
2. **It is safe to learn.** The client can click around, make mistakes and try things on a free account without a bill.
3. **Upgrading is easy and keeps everything.** When you pay, you press "Upgrade" inside the same account. Nothing is moved, rebuilt or lost.
4. **Everyone sees the real cost before committing.** By the time we upgrade, the client has seen the system working.

## Why we do NOT stay free

Free plans are made for trying things out, not for a business to depend on. What we learned in our own testing:

| Service | What the free plan does | Why that is a problem |
|---|---|---|
| **Supabase** | Switches off a project that has not been used for about a week. Has no automatic backups. Slows down when it is busy. | The whole system can stop. A mistake cannot be undone. In our testing, pages timed out and the system failed several times. |
| **Vercel** | The free plan is for personal, non-commercial use only. | A client's business system is commercial, so it breaks the company's rules. |
| **Resend** | Allows only 100 emails a day. | A busy day of sign-off reminders could go over, and the emails would simply stop. |

<div class="warn"><b>Rule of thumb:</b> free for <b>setting up and trying</b>. Paid for <b>real use</b>. Never let real project data or real users depend on a free plan.</div>

## When to pay for each one

| Stage | What is happening | What to upgrade | Monthly cost from then |
|---|---|---|---|
| **A. Setting up** | Creating accounts, building and testing alone | Nothing yet. Railway costs $5 from day one. | about $5 (plus the domain, bought once) |
| **B. Client trial** | The client tests with real-looking data | **Supabase to Pro** (before the trial starts) | about $30 |
| **C. Go-live** | Real users start | **Vercel to Pro** and **Resend to Pro** | about $70 to $85 |
| **D. After one week** | Check the worker is coping | Railway: stay on $5, or move up if needed | $5 to $20 plus usage |

<div class="tip"><b>Why Supabase first?</b> It is the heart of the system and the one that failed us on free. Pay for it before the client starts testing, so they never judge the system by a slow free account.</div>

# 3. The six services, one by one

## Cloudflare: the web address

- **What it is:** the company where you register the web address (for example `acmeqa.com`) and where you control where it points.
- **Free or paid:** the address costs about $10 a year, paid once a year. The control panel is free.
- **Why we use it:** it sells addresses at cost with no extra charge, and the client owns the address.

## GitHub: where the code is kept

- **What it is:** an online safe for the website's code, with a history of every change.
- **Free or paid:** free.
- **Why we use it:** Vercel and Railway read the code from here. If the code lives in the client's GitHub, the client controls updates.

## Supabase: the storeroom

- **What it is:** keeps every record: projects, inspections, sign-offs, NCRs, photos, PDFs and everyone's logins.
- **Free or paid:** free to start, **Pro at $25 a month for real use.**
- **What Pro gives you:** automatic daily backups for 7 days, no switching off, steady speed.

## Railway: the PDF maker

- **What it is:** a small computer that is always on. It builds PDFs and sends automatic reminders every 15 minutes.
- **Free or paid:** from **$5 a month** (Hobby), plus a little for what it uses.
- **Why we use it:** building PDFs takes time and needs a special program, so it needs its own always-on machine.

## Vercel: the website itself

- **What it is:** runs the website so people can open it in their browser.
- **Free or paid:** free to try, **Pro at $20 a month per person who updates the site** for real use.
- **Why we use it:** it updates the website automatically whenever the approved code changes.

## Resend: the email sender

- **What it is:** sends emails from the system, such as invitations and sign-off requests.
- **Free or paid:** free for 100 emails a day, **Pro at $20 a month** for 50,000 emails a month.
- **Why we use it:** emails sent from the client's own address are trusted, so they do not go to spam.

**Optional: Power BI** makes management charts. Power BI Desktop is free; people who view shared reports need **Pro at $14 a month each.**

# 4. A worked example: "Acme Engineering"

Follow this made-up client to see how the pieces fit together. Replace the example values with the client's own.

<div class="ex">
<b>The client:</b> Acme Engineering Pty Ltd<br>
<b>Web address bought:</b> <code>acmeqa.com</code><br>
<b>Address people will use:</b> <code>qmp.acmeqa.com</code><br>
<b>Shared mailbox used to register everything:</b> <code>it@acmeqa.com</code><br>
<b>Owner:</b> Priya Nair (managing director), the account owner everywhere<br>
<b>Developer:</b> invited by email, with limited roles
</div>

| Stage | What Acme does | Cost that month |
|---|---|---|
| Week 1 | Creates all accounts using it@acmeqa.com. Buys acmeqa.com for about $10. Starts Railway at $5. | about $15 once, then $5 |
| Weeks 2–4 | Developer sets everything up; Acme looks at it | $5 |
| Week 5 | Acme starts its trial with real-looking data. **Supabase upgraded to Pro.** | $30 |
| Week 8 | Go-live. **Vercel and Resend upgraded to Pro.** | about $75 |
| Week 9 | Check Railway usage. Stays on $5. | about $75 |
| Every month after | Same bills, no surprises | about $75 |

**What Acme ends up owning:** the web address, the code, the database, the website, the PDF maker and the email account, all under it@acmeqa.com, and all in its name.

# 5. Step-by-step: create each account

<div class="tip"><b>Before you start (15 minutes):</b> 1) Create the shared mailbox, for example it@acmeqa.com. 2) Open the company's password manager. 3) Have the company card ready. 4) Have the developer's email address ready.</div>

**Do these four things for every account:**
1. Sign up using the **shared mailbox**, never a personal email.
2. Turn on **two-step login** (a code from a phone app when signing in).
3. Save the password and the **recovery codes** in the password manager.
4. Write it in the **account list** (a blank one is in Part 8).

## Step 5.1 GitHub

1. Go to **github.com** and press **Sign up**. Use the shared mailbox.
2. Turn on two-step login (Settings, Password and authentication).
3. Click your picture (top right), then **Your organizations**, then **New organization**.
4. Choose the **Free** plan. Name it after the client, for example "Acme Engineering".
5. Later, you will create a private box (called a repository) inside it for the code.
6. To invite the developer: open the organisation, press **People**, **Invite member**, enter their email, and choose **Member**. Do not choose Owner.

*What you should see:* the organisation page with your name as Owner.

## Step 5.2 Cloudflare and the web address

1. Go to **cloudflare.com** and press **Sign up**. Use the shared mailbox. Turn on two-step login.
2. Open **Domain Registration**, then **Register Domains**.
3. Type the name you want, for example `acmeqa`, and press search.
4. Choose an ending that is available (`.com` is the most common). Check the yearly price shown.
5. Press **Purchase** and pay with the company card.
6. Make sure **Auto-renew** is switched **on** (this stops the address expiring by accident).

<div class="tip"><b>If the ending you want is not sold here</b> (some country endings are not): buy it from another registrar, then ask that registrar to point the "name servers" to the two Cloudflare gives you. You do this once.</div>

*What you should see:* your address listed under "Domains" as Active.

## Step 5.3 Supabase (the database)

1. Go to **supabase.com** and press **Start your project**. Sign up with the shared mailbox. Turn on two-step login.
2. Create an **Organization**. Name it after the client.
3. **Start on the Free plan while you set up.** (You will upgrade before the client trial; see Part 2.)
4. Press **New project**. Choose:
   - **Name:** for example `acme-qmp`
   - **Database password:** use the generator, then **save it in the password manager immediately**. You cannot see it again.
   - **Region:** pick the one **closest to the people using it** (this cannot be changed later). Check the client's rules about where data may be kept.
5. Wait about two minutes for the project to start.
6. Open **Project Settings, API**. Copy and save in the password manager: the **Project URL**, the **anon key** and the **service_role key**.
7. Invite the developer: **Organization settings, Team, Invite**, role **Developer**. Not Owner.

<div class="warn"><b>Keep the service_role key secret.</b> It opens everything. Never email it, never paste it in a chat, never put it in the code.</div>

*What you should see:* a project showing "Healthy".

## Step 5.4 Railway (the PDF maker)

1. Go to **railway.com** and press **Login**, then **Login with GitHub**. Use the client's GitHub.
2. Choose the **Hobby** plan ($5 a month) and add the company card.
3. Press **New Project**. Name it, for example "acme-qmp-worker". The actual service is added in Part 6.
4. Invite the developer: **Project Settings, Members, Invite**, role **Member**.

*What you should see:* an empty project and a billing page showing Hobby.

## Step 5.5 Vercel (the website)

1. Go to **vercel.com** and press **Sign Up**, then **Continue with GitHub**. Use the client's GitHub.
2. Create a **Team** named after the client.
3. **While setting up,** you may stay on the free plan to look around. Before real users arrive you must be on **Pro** ($20 a month per person who updates the site).
4. Invite the developer: **Settings, Members, Invite**, role **Member**.

<div class="warn"><b>Check before you rely on the free plan:</b> I could not confirm whether Vercel's free plan can use code held in a GitHub <i>organisation</i>. If it refuses, buy Pro for the setup month. It costs $20.</div>

*What you should see:* your team's dashboard with no projects yet.

## Step 5.6 Resend (the emails)

1. Go to **resend.com** and sign up with the shared mailbox. Turn on two-step login.
2. Press **Domains**, then **Add Domain**, and type the client's address, for example `acmeqa.com`.
3. Resend shows a short list of records (named SPF and DKIM). **Leave this page open.** You will copy them into Cloudflare in Step 6.8.
4. Press **API Keys**, then **Create API Key**. Choose **Sending access**. Copy the key once and save it in the password manager.
5. Stay on the free plan while testing. Upgrade to **Pro** at go-live.

*What you should see:* your domain listed as "Pending" until you finish Step 6.8.

# 6. Step-by-step: set up the system

The client creates the accounts. These steps are done together with the developer.

## Step 6.1 Put the code in the client's GitHub
The developer creates an empty **private** repository in the client's organisation (for example `qmp-inspect`) and uploads the code. They check that no password or key is inside the code.
*Why:* the client then owns the code, and Vercel and Railway read from it.

## Step 6.2 Prepare the database
1. The developer copies the existing, working database structure into the new Supabase project (a "schema copy"). This is safer than rebuilding it from the 285 history files.
2. **Practise first** on a spare free project and click through the website, to be sure the copy works. (This copy method has not yet been tried on a blank project.)
3. In the new project open **Authentication, URL Configuration**. Set the **Site URL** to `https://qmp.acmeqa.com` and add it to **Redirect URLs**.
4. Paste in the email wording files provided in the code (invite, password reset and so on).
5. Set the minimum password length to 12 and turn on email confirmation.

## Step 6.3 Create the real people
1. In **Authentication, Users**, press **Add user** and create the real **Admin** login. Sign in once and set a new password.
2. Create the **Field Engineer** login limited to the organisations that person should see.
3. **Do not use the sample data file.** It creates test accounts that share one password.

## Step 6.4 Make the shared secret
Make a long random password of about 40 characters. This is the **CRON_SECRET**. It lets the PDF maker prove to the website that it may trigger the automatic reminders. The **same text** goes into both Railway and Vercel.

## Step 6.5 Start the PDF maker (Railway)
1. In Railway press **New**, **GitHub Repo**, and choose the client's repository.
2. Enter the build and start commands the developer supplies.
3. Open **Variables** and add these: the database address, the service key, the website address, the shared secret, and the email key.
4. Press **Deploy** and watch the log. It should say the Chrome browser was installed and the worker has started.

## Step 6.6 Start the website (Vercel)
1. In Vercel press **Add New, Project** and pick the client's repository.
2. Set the **Root Directory** to `apps/web` (this tells Vercel which folder holds the website).
3. Add all the variables the developer supplies (database address and keys, website address, shared secret, email key and sender, support email).
4. Press **Deploy**.

## Step 6.7 Connect the web address
1. In Vercel open **Settings, Domains**, and add `qmp.acmeqa.com`. Vercel shows one record to add.
2. In Cloudflare open **DNS**, press **Add record**, and enter exactly what Vercel showed.
3. Set the cloud icon to **grey ("DNS only")**, not orange. Orange can break the secure padlock.

## Step 6.8 Connect the email
1. Go back to the open Resend page and copy each record it lists.
2. In Cloudflare **DNS**, add each one, again with the cloud **grey**.
3. In Resend press **Verify**. It turns to **Verified** within a few minutes (sometimes up to a day).

<div class="tip"><b>If something looks wrong,</b> do not guess. Check Part 10, which lists the real problems we met and how we fixed them.</div>

# 7. Checking that everything works

Do every line before telling anyone it is live.

| # | Do this | You should see |
|---|---|---|
| 1 | Open `qmp.acmeqa.com/api/health` | The words `"status":"ok"` and four green items: database, schema, storage, worker |
| 2 | Sign in as the Admin | The dashboard opens. No test accounts exist. |
| 3 | Sign in as the Field Engineer | Only the allowed organisations appear |
| 4 | Create an organisation, a project and an inspection plan | Each saves without an error |
| 5 | Press the PDF button on a plan | A PDF arrives with the JAGS logo and correct words |
| 6 | Add a new person with a login | An invitation email arrives from the client's own address and is **not in spam** |
| 7 | In Vercel, open **Logs** and look for the path `/api/cron/signoff-automation` | A line saying **200** about every 15 minutes |
| 8 | In Supabase open **Database, Backups** | A daily backup is listed (this needs the Pro plan) |

<div class="warn"><b>Number 7 explained:</b> 401 means the two shared secrets are different. 503 means the website has no shared secret at all. Fix by entering the same text in Railway and Vercel and redeploying both.</div>

# 8. Handing over to the client

## 8.1 What the client must end up with

1. A list of every account, who owns it and which mailbox it uses.
2. Confirmation that **no test accounts remain**.
3. A cost sheet with each monthly bill and the renewal dates.
4. The restore steps: what to do if data is lost, and who to call.
5. A record of what the developer can access, and how to remove them.
6. The completed checks from Part 7, dated.
7. A written support agreement.

## 8.2 Account list (fill in)

| Service | Mailbox used | Owner | Plan | Renews on | Two-step on? | Developer's role |
|---|---|---|---|---|---|---|
| GitHub | | | Free | | | Member / Write |
| Cloudflare | | | Free + address | | | None |
| Supabase | | | Pro | | | Developer |
| Railway | | | Hobby | | | Member |
| Vercel | | | Pro | | | Member |
| Resend | | | Pro | | | None |

## 8.3 What the developer should and should not hold

| | Should have | Should never have |
|---|---|---|
| Access | A limited role on each service | Owner role, or the right to change billing |
| Secrets | Only what the work needs | The client's personal logins |
| Data | A **separate test copy** for new work | Permission to experiment on the live data |

## 8.4 Developer access afterwards: is it a good idea?

Yes, if it is limited and written down. The client stays safe because the developer cannot change billing or ownership. The developer stays safe because new work is tried on a **separate practice copy**, so a mistake never touches client data. The client can remove the developer at any time.

## 8.5 Sign-off

| | Name | Signature | Date |
|---|---|---|---|
| Client owner | | | |
| Developer | | | |

# 9. Keeping it healthy after handover

| How often | What to do | Why |
|---|---|---|
| **Always on** | An uptime service watches `/api/health` every 5 minutes and emails if it fails | You hear about a problem before the users do |
| **Every month (10 minutes)** | Look at the usage page of Supabase, Vercel, Railway and Resend | Catch a growing bill early |
| **First 3 months** | Do the monthly look on the **1st of every month** | Learn the normal level |
| **Every 3 months** | Review who has access; remove people who left | Security |
| **Once after go-live, then yearly** | Practise restoring a backup into a spare project | A backup you never tested may not work |
| **When anything changes** | New features go to a practice copy first, then live after a backup | Protects real data |

**What can raise the bill**

| Service | Watch for |
|---|---|
| Supabase | Lots of photos and files, very large data, bigger machine, extra "restore to any minute" option ($100 a month) |
| Vercel | More people updating the site ($20 each), very heavy traffic |
| Railway | The PDF maker using lots of memory |
| Resend | More than 50,000 emails a month |
| Power BI | Each extra viewer ($14) |

# 10. Common problems and simple fixes

| What you see | Likely reason | Simple fix |
|---|---|---|
| Pages are slow or say "Something went wrong" | The free database is overloaded | Upgrade Supabase to Pro. Meanwhile, stop heavy use and wait. |
| A page shows an error after about 30 seconds | The database was too slow at that moment | Same as above |
| A PDF fails and says it cannot find Chrome | The Chrome program was not installed in that build | Redeploy the PDF maker with a clean build |
| The reminder check shows 401 | The two shared secrets are different | Make them identical in Railway and Vercel, then redeploy both |
| The reminder check shows 503 | The website has no shared secret | Add it in Vercel and redeploy |
| Emails go to spam | Email records not set up or not verified | Add the Resend records in Cloudflare (grey cloud) and press Verify |
| The padlock is missing or the page loops | The Cloudflare cloud is orange | Set the record to grey ("DNS only") |
| People cannot sign in after the move | The website address in Supabase is old | Update it in Authentication, URL Configuration |
| Power BI says "too many connections" | Wrong connection type | Use the transaction connection (port 6543) and turn off parallel loading |
| A finished project will not change | By design, finished projects are locked | Follow the documented reopen steps |

# 11. Questions people ask

**Can we just use the free plans forever?** No, not for real use. Free plans can switch off, have no backups, and Vercel's is not allowed for business use.

**Will we lose anything when we upgrade?** No. You press Upgrade inside the same account and everything stays exactly as it was.

**Why not put it all on one service to save money?** It is possible: the website can run on Railway too, which saves roughly $15 to $25 a month. We have not tested that, so try it first before moving.

**Who pays?** The client, directly to each company, using the client's own card. The developer is not involved in billing.

**What if the developer is unavailable?** Because the client owns every account and holds the handover pack, another developer can be invited in. That is the main reason for this setup.

**Is point-in-time recovery needed?** It lets you go back to any minute, and costs $100 a month for 7 days. Most clients are fine with the daily backups that come with Pro. Offer it, but do not assume it.

**Can the system be moved to another company later?** Yes. Because the client owns the address, the code and the data, any one service can be swapped without starting again.

# 12. Words explained simply

| Word | Meaning in plain words |
|---|---|
| Account | A login to a service, owned by a person or company |
| Organisation / Team | A shared space inside a service, so several people can work together |
| Owner | The person with full control, including payment |
| Member / Developer | A person with limited rights, who cannot change payment or ownership |
| Two-step login | Signing in with your password plus a code from your phone |
| Domain | The web address, for example acmeqa.com |
| DNS | The address book that tells the internet where your domain points |
| Database | The place where all the records are kept |
| Backup | A saved copy you can restore if something goes wrong |
| Deploy | Put the latest version of the website live |
| Worker | A helper program that runs in the background, here it builds PDFs |
| Secret / key | A password for programs, never to be shared |
| Staging | A practice copy of the system used to test changes safely |
| Subscription | The monthly payment for a paid plan |
| Upgrade | Move to a paid plan inside the same account |
| ITP | Inspection and test plan |
| NCR | A report that records something that did not meet the requirement |
| Hold point | A step that work cannot pass until it is signed off |
| Data Book | The finished, issued record of a project's inspections and documents |
