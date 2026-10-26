import type {
  Activity,
  ActivityType,
  Campaign,
  CampaignStep,
  Conversation,
  DailyPoint,
  DashboardSummary,
  Lead,
  LeadLabel,
  LeadList,
  Mailbox,
  Message,
  Opportunity,
  WorkspaceUser,
} from "@/types";

/* ---------------------------------------------------------------------------
   Deterministic mock dataset.

   This exists so the whole UI is reviewable before the Hono api exists.
   Every value is derived from a fixed seed, so screenshots and tests are
   stable. Delete this file once `VITE_USE_MOCKS=false` is permanent.
--------------------------------------------------------------------------- */

const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

/** Tiny deterministic PRNG so the dataset never shifts between reloads. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const rand = makeRandom(20261022);
const pick = <T,>(items: readonly T[]): T =>
  items[Math.floor(rand() * items.length)] as T;
const between = (min: number, max: number) =>
  Math.floor(rand() * (max - min + 1)) + min;

/* ------------------------------------------------------------------------- */
/* Labels                                                                     */
/* ------------------------------------------------------------------------- */

export const labels: LeadLabel[] = [
  {
    id: 1,
    name: "Interested",
    description: "The lead has expressed interest or asked for more information.",
    interest: "positive",
    isBuiltin: 1,
    useAi: 1,
  },
  {
    id: 2,
    name: "Meeting Booked",
    description: "A call or meeting has been confirmed on the calendar.",
    interest: "positive",
    isBuiltin: 1,
    useAi: 1,
  },
  {
    id: 3,
    name: "Meeting Completed",
    description: "The booked meeting has taken place but the deal is still open.",
    interest: "positive",
    isBuiltin: 1,
    useAi: 0,
  },
  {
    id: 4,
    name: "Won",
    description: "The lead has become a paying customer.",
    interest: "positive",
    isBuiltin: 1,
    useAi: 0,
  },
  {
    id: 5,
    name: "Not Interested",
    description: "The lead has explicitly declined.",
    interest: "negative",
    isBuiltin: 1,
    useAi: 1,
  },
  {
    id: 6,
    name: "Wrong Person",
    description: "The contact is not the right person for this offer.",
    interest: "negative",
    isBuiltin: 1,
    useAi: 1,
  },
  {
    id: 7,
    name: "Out of Office",
    description: "An automatic reply saying the person is away, usually with a return date.",
    interest: "neutral",
    isBuiltin: 1,
    useAi: 1,
  },
  {
    id: 8,
    name: "No Show",
    description: "The lead did not attend a booked meeting.",
    interest: "negative",
    isBuiltin: 1,
    useAi: 0,
  },
  {
    id: 9,
    name: "Wants a demo",
    description: "The lead asked to see a product demo before committing.",
    interest: "positive",
    isBuiltin: 0,
    useAi: 1,
  },
  {
    id: 10,
    name: "Referral",
    description: "The lead pointed us at a colleague who owns the problem.",
    interest: "positive",
    isBuiltin: 0,
    useAi: 1,
  },
];

export const labelById = new Map(labels.map((l) => [l.id, l]));

/* ------------------------------------------------------------------------- */
/* Users                                                                      */
/* ------------------------------------------------------------------------- */

export const users: WorkspaceUser[] = [
  {
    id: "usr_1",
    name: "Haroon Ehsan",
    email: "haroon@ehsaantech.com",
    role: "admin",
    active: true,
  },
  {
    id: "usr_2",
    name: "Ayesha Khan",
    email: "ayesha@ehsaantech.com",
    role: "member",
    active: true,
  },
  {
    id: "usr_3",
    name: "Bilal Ahmed",
    email: "bilal@ehsaantech.com",
    role: "member",
    active: true,
  },
];

/* ------------------------------------------------------------------------- */
/* Mailboxes                                                                  */
/* ------------------------------------------------------------------------- */

const mailboxSeeds: Array<{
  email: string;
  name: string;
  provider: Mailbox["provider"];
  tags: string[];
}> = [
  { email: "sarah@getacme.io", name: "Sarah Whitfield", provider: "google", tags: ["client-acme", "us"] },
  { email: "james@getacme.io", name: "James Porter", provider: "google", tags: ["client-acme", "us"] },
  { email: "nina@getacme.io", name: "Nina Alvarez", provider: "microsoft", tags: ["client-acme", "us"] },
  { email: "tom@northpeak.co", name: "Tom Bradshaw", provider: "google", tags: ["client-northpeak", "uk"] },
  { email: "lena@northpeak.co", name: "Lena Fischer", provider: "microsoft", tags: ["client-northpeak", "eu"] },
  { email: "owen@northpeak.co", name: "Owen Reid", provider: "imap_smtp", tags: ["client-northpeak", "uk"] },
  { email: "priya@flowdesk.dev", name: "Priya Nair", provider: "google", tags: ["client-flowdesk", "us"] },
  { email: "marcus@flowdesk.dev", name: "Marcus Bell", provider: "google", tags: ["client-flowdesk", "us"] },
];

export const mailboxes: Mailbox[] = mailboxSeeds.map((seed, i) => {
  const status: Mailbox["status"] =
    i === 5 ? "degraded" : i === 7 ? "failed" : "connected";
  const health = i === 5 ? 38 : i === 7 ? 12 : between(82, 99);
  return {
    id: `mbx_${i + 1}`,
    email: seed.email,
    displayName: seed.name,
    provider: seed.provider,
    status,
    dailyCap: i === 5 ? 20 : 30,
    healthScore: health,
    sentToday: status === "connected" ? between(12, 28) : status === "degraded" ? 9 : 0,
    tags: seed.tags,
    lastCheckedAt: iso(between(2, 55) * MINUTE),
    lastError:
      status === "failed"
        ? "SMTP authentication failed (535 5.7.8). App password may have been revoked."
        : status === "degraded"
          ? "Elevated bounce rate over the last 7 days (6.4%)."
          : null,
    warmupProgress: null,
  };
});

/* ------------------------------------------------------------------------- */
/* Campaigns                                                                  */
/* ------------------------------------------------------------------------- */

interface CampaignSeed {
  name: string;
  status: Campaign["status"];
  tags: string[];
  mailboxIds: string[];
  leadCount: number;
  pausedReason?: string;
  ageDays: number;
}

const campaignSeeds: CampaignSeed[] = [
  {
    name: "Q4 · US SaaS Founders",
    status: "active",
    tags: ["saas", "us", "q4"],
    mailboxIds: ["mbx_1", "mbx_2", "mbx_3"],
    leadCount: 1840,
    ageDays: 26,
  },
  {
    name: "Q4 · UK Agency Owners",
    status: "active",
    tags: ["agency", "uk", "q4"],
    mailboxIds: ["mbx_4", "mbx_5", "mbx_6"],
    leadCount: 960,
    ageDays: 19,
  },
  {
    name: "Flowdesk · Series A CTOs",
    status: "active",
    tags: ["flowdesk", "cto", "us"],
    mailboxIds: ["mbx_7", "mbx_8"],
    leadCount: 620,
    ageDays: 11,
  },
  {
    name: "Re-engage · No reply 90d",
    status: "paused",
    tags: ["re-engagement"],
    mailboxIds: ["mbx_1", "mbx_4"],
    leadCount: 2400,
    pausedReason: "Hard bounce rate 5.8% exceeded the 5% threshold after 214 sends.",
    ageDays: 42,
  },
  {
    name: "Northpeak · Ops Managers EU",
    status: "active",
    tags: ["northpeak", "ops", "eu"],
    mailboxIds: ["mbx_5", "mbx_6"],
    leadCount: 1310,
    ageDays: 7,
  },
  {
    name: "Draft · Logistics Leaders",
    status: "draft",
    tags: ["logistics", "draft"],
    mailboxIds: [],
    leadCount: 0,
    ageDays: 2,
  },
  {
    name: "Acme · Closed Won Expansion",
    status: "completed",
    tags: ["acme", "expansion"],
    mailboxIds: ["mbx_1", "mbx_2"],
    leadCount: 480,
    ageDays: 65,
  },
];

function campaignsFromSeeds(): Campaign[] {
  return campaignSeeds.map((seed, i) => {
    const contacted =
      seed.status === "draft"
        ? 0
        : seed.status === "completed"
          ? seed.leadCount
          : Math.round(seed.leadCount * (0.32 + rand() * 0.5));

    const replied = Math.round(contacted * (0.028 + rand() * 0.055));
    const positive = Math.round(replied * (0.32 + rand() * 0.28));
    const opportunities = Math.max(
      0,
      Math.round(positive * (0.45 + rand() * 0.35)),
    );

    return {
      id: `cmp_${i + 1}`,
      name: seed.name,
      status: seed.status,
      createdAt: iso(seed.ageDays * DAY),
      launchedAt:
        seed.status === "draft" ? null : iso((seed.ageDays - 1) * DAY),
      dailyLimit: seed.mailboxIds.length * 30,
      dailyMaxLeads: 120,
      leadCount: seed.leadCount,
      contacted,
      progress: seed.leadCount === 0 ? 0 : Math.round((contacted / seed.leadCount) * 100),
      sent: contacted === 0 ? 0 : contacted + Math.round(contacted * 0.4),
      opened:
        seed.status === "draft"
          ? 0
          : Math.round(contacted * (0.38 + rand() * 0.22)),
      replied,
      positiveReplies: positive,
      opportunities,
      opportunityValue: opportunities * between(180000, 950000),
      bounced:
        seed.status === "draft" ? 0 : Math.round(contacted * (0.008 + rand() * 0.03)),
      mailboxIds: seed.mailboxIds,
      stepCount: 3 + (i % 2),
      pausedReason: seed.pausedReason ?? null,
      tags: seed.tags,
    };
  });
}

export const campaigns: Campaign[] = campaignsFromSeeds();

export const campaignById = new Map(campaigns.map((c) => [c.id, c]));

/* ------------------------------------------------------------------------- */
/* Campaign steps                                                             */
/* ------------------------------------------------------------------------- */

function stepsFor(campaign: Campaign): CampaignStep[] {
  const bodies = [
    "Hi {{first_name}},\n\nI noticed {{company}} is hiring for a role that usually means the team is scaling outbound. Most teams at that stage hit a wall with inbox placement long before they run out of leads.\n\nWe run cold email for a handful of B2B teams — we handle the domains, the mailboxes, and the rotation so the reply rate stays where it should.\n\nWorth a 15-minute look?\n\n— Sarah",
    "Hi {{first_name}},\n\nFollowing up on my note from last week. If outbound isn't a priority right now, no problem — happy to circle back next quarter.\n\nIf it is, I can send over the two-page teardown we did for a similar {{industry}} team.\n\n— Sarah",
    "Hi {{first_name}},\n\nLast note from me. I put together a short breakdown of what we'd change in {{company}}'s current outbound setup based on what's publicly visible. No charge, no call required — just reply \"send it\" and it's yours.\n\n— Sarah",
    "Hi {{first_name}},\n\nClosing the loop — I'll assume the timing isn't right and stop here. If it changes, you know where to find me.\n\n— Sarah",
  ];

  const count = campaign.stepCount;
  return Array.from({ length: count }, (_, idx) => {
    const sent = Math.max(0, Math.round((campaign.sent / count) * (count - idx) * 0.8));
    const opened = Math.round(sent * (0.35 + rand() * 0.2));
    const replied = Math.round(sent * (0.02 + rand() * 0.035));

    const base = {
      id: `stp_${campaign.id}_${idx + 1}`,
      campaignId: campaign.id,
      position: idx + 1,
      bodyHtml: bodies[idx % bodies.length] as string,
      preheader:
        idx === 0 ? "We handle the domains, mailboxes and rotation." : null,
      delayMinutes: idx === 0 ? 0 : [1440, 2880, 4320][idx - 1] ?? 1440,
      threadMode: (idx === 0 ? "new_thread" : "reply") as
        | "reply"
        | "new_thread",
      sent,
      opened,
      replied,
    };

    // Step 1 gets an A/Z test; later steps carry a single variant.
    const variants =
      idx === 0
        ? [
            {
              id: `${base.id}_a`,
              label: "A",
              subject: "Quick question about {{company}}'s outbound",
              weight: 50,
              sent: Math.round(sent * 0.51),
              replied: Math.round(replied * 0.58),
              pinned: false,
            },
            {
              id: `${base.id}_b`,
              label: "B",
              subject: "{{first_name}} — 15 minutes?",
              weight: 50,
              sent: Math.round(sent * 0.49),
              replied: Math.round(replied * 0.42),
              pinned: false,
            },
          ]
        : [
            {
              id: `${base.id}_a`,
              label: "A",
              subject: idx === 1 ? "" : "Re: Quick question about {{company}}'s outbound",
              weight: 100,
              sent,
              replied,
              pinned: false,
            },
          ];

    return {
      ...base,
      subject:
        idx === 0
          ? "Quick question about {{company}}'s outbound"
          : idx === 1
            ? null
            : "Re: Quick question about {{company}}'s outbound",
      variants,
    };
  });
}

export const campaignSteps = new Map<string, CampaignStep[]>(
  campaigns.map((c) => [c.id, stepsFor(c)]),
);

/* ------------------------------------------------------------------------- */
/* Lead lists                                                                 */
/* ------------------------------------------------------------------------- */

export const lists: LeadList[] = [
  {
    id: "lst_1",
    name: "SaaS founders — US, 20-200 employees",
    leadCount: 1840,
    createdAt: iso(30 * DAY),
    description: "Pulled from Apollo, verified with NeverBounce, 94% deliverable.",
  },
  {
    id: "lst_2",
    name: "UK agency owners",
    leadCount: 960,
    createdAt: iso(22 * DAY),
    description: "Scraped from Clutch, deduped against the master blocklist.",
  },
  {
    id: "lst_3",
    name: "Series A CTOs",
    leadCount: 620,
    createdAt: iso(13 * DAY),
    description: null,
  },
  {
    id: "lst_4",
    name: "Master blocklist export",
    leadCount: 312,
    createdAt: iso(60 * DAY),
    description: "Everyone who ever bounced or unsubscribed. Do not re-import.",
  },
];

/* ------------------------------------------------------------------------- */
/* Leads                                                                      */
/* ------------------------------------------------------------------------- */

const firstNames = [
  "Daniel", "Megan", "Rahul", "Sofia", "Ethan", "Chloe", "Marcus", "Priya",
  "Liam", "Nora", "Owen", "Isabel", "Felix", "Aisha", "Noah", "Grace",
  "Leo", "Maya", "Jonas", "Elena", "Caleb", "Zara", "Hugo", "Amara",
  "Theo", "Iris", "Miles", "Freya", "Arjun", "Talia",
];

const lastNames = [
  "Chen", "Murphy", "Patel", "Rossi", "Brooks", "Dubois", "Walsh", "Nair",
  "O'Connor", "Lindqvist", "Hayes", "Moreau", "Weber", "Rahman", "Bennett",
  "Okafor", "Fischer", "Tanaka", "Silva", "Novak", "Foster", "Haddad",
  "Klein", "Mensah", "Reeves", "Kowalski", "Sutton", "Larsen", "Mehta", "Cohen",
];

const companies = [
  "Northwind Labs", "Cobalt Systems", "Brightline", "Fernwood", "Kestrel AI",
  "Palewood", "Driftworks", "Tidewater", "Lumen Health", "Ironvale",
  "Quarry Software", "Meridian Ops", "Halcyon", "Basecamp Digital", "Foxglove",
  "Redstone Cloud", "Willow & Co", "Beacon Analytics", "Sableworks", "Aperture",
  "Clearwater", "Ember Logistics", "Granite Peak", "Hollowbrook", "Juniper",
  "Keystone Data", "Larkspur", "Monarch Labs", "Nightingale", "Orchard Tech",
];

const titles = [
  "Founder & CEO", "Head of Growth", "VP Sales", "Marketing Director",
  "COO", "Head of RevOps", "CTO", "Demand Gen Lead", "Sales Manager",
  "Chief of Staff",
];

const domains = [
  "northwindlabs.com", "cobalt.systems", "brightline.io", "fernwood.co",
  "kestrel.ai", "palewood.com", "driftworks.io", "tidewater.co",
  "lumenhealth.com", "ironvale.dev", "quarrysoft.com", "meridianops.co",
  "halcyonhq.com", "basecampdigital.io", "foxglove.co", "redstonecloud.com",
  "willowand.co", "beaconanalytics.io", "sableworks.com", "aperturehq.io",
  "clearwater.co", "emberlogistics.com", "granitepeak.io", "hollowbrook.co",
  "juniper.dev", "keystonedata.com", "larkspur.io", "monarchlabs.co",
  "nightingalehq.com", "orchardtech.io",
];

function leadsFromSeeds(): Lead[] {
  return Array.from({ length: 60 }, (_, i) => {
    const first = pick(firstNames);
    const last = pick(lastNames);
    const company = pick(companies);
    const domain = domains[i % domains.length] as string;
    const statusRoll = rand();

    const statusId =
      statusRoll > 0.9
        ? 2
        : statusRoll > 0.78
          ? 1
          : statusRoll > 0.7
            ? 9
            : statusRoll > 0.6
              ? 7
              : statusRoll > 0.42
                ? 5
                : statusRoll > 0.34
                  ? 6
                  : 0;

    const emailStatus: Lead["emailStatus"] =
      i % 17 === 0 ? "invalid" : i % 11 === 0 ? "risky" : i % 7 === 0 ? "catch_all" : "valid";

    const campaign = campaigns[i % campaigns.length] as Campaign;

    return {
      id: `led_${i + 1}`,
      email: `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, "")}@${domain}`,
      firstName: first,
      lastName: last,
      company,
      title: pick(titles),
      statusId,
      emailStatus,
      ownerId: i % 3 === 0 ? "usr_1" : i % 3 === 1 ? "usr_2" : "usr_3",
      campaignId: campaign.status === "draft" ? null : campaign.id,
      listIds: [lists[i % 3]?.id ?? "lst_1"],
      createdAt: iso(between(1, 30) * DAY),
      lastActivityAt: iso(between(5, 4000) * MINUTE),
      customVariables: {
        industry: pick(["SaaS", "Professional Services", "Logistics", "Healthcare", "Fintech"]),
        pain_point: pick([
          "outbound plateau",
          "poor inbox placement",
          "no dedicated SDR",
          "long sales cycles",
        ]),
        headcount: String(between(18, 420)),
      },
    };
  });
}

export const leads: Lead[] = leadsFromSeeds();

/* ------------------------------------------------------------------------- */
/* Conversations + messages                                                   */
/* ------------------------------------------------------------------------- */

interface ConversationSeed {
  name: string;
  email: string;
  company: string;
  campaignIdx: number;
  mailboxIdx: number;
  subject: string;
  preview: string;
  folder: Conversation["folder"];
  statusId: number;
  minutesAgo: number;
  unread: boolean;
  starred: boolean;
  reminder: boolean;
}

const conversationSeeds: ConversationSeed[] = [
  {
    name: "Daniel Chen",
    email: "daniel.chen@northwindlabs.com",
    company: "Northwind Labs",
    campaignIdx: 0,
    mailboxIdx: 0,
    subject: "Re: Quick question about Northwind Labs' outbound",
    preview: "This is actually well timed. We're evaluating whether to build an SDR team or outsource. Can you send the teardown you mentioned?",
    folder: "primary",
    statusId: 1,
    minutesAgo: 12,
    unread: true,
    starred: true,
    reminder: false,
  },
  {
    name: "Megan Murphy",
    email: "megan.murphy@cobalt.systems",
    company: "Cobalt Systems",
    campaignIdx: 0,
    mailboxIdx: 1,
    subject: "Re: Quick question about Cobalt Systems' outbound",
    preview: "Booked for Thursday 2pm. Looking forward to it — I've looped in our Head of RevOps so she can hear this too.",
    folder: "primary",
    statusId: 2,
    minutesAgo: 47,
    unread: true,
    starred: true,
    reminder: true,
  },
  {
    name: "Rahul Patel",
    email: "rahul.patel@brightline.io",
    company: "Brightline",
    campaignIdx: 1,
    mailboxIdx: 3,
    subject: "Re: Quick question about Brightline's outbound",
    preview: "Not the right person for this — I run finance, not growth. Try copying Laura on this, she owns demand gen.",
    folder: "primary",
    statusId: 6,
    minutesAgo: 96,
    unread: false,
    starred: false,
    reminder: false,
  },
  {
    name: "Sofia Rossi",
    email: "sofia.rossi@fernwood.co",
    company: "Fernwood",
    campaignIdx: 1,
    mailboxIdx: 4,
    subject: "Automatic reply: Quick question about Fernwood's outbound",
    preview: "I'm out of the office until 4 November with limited access to email. For anything urgent please contact ops@fernwood.co.",
    folder: "primary",
    statusId: 7,
    minutesAgo: 180,
    unread: false,
    starred: false,
    reminder: false,
  },
  {
    name: "Ethan Brooks",
    email: "ethan.brooks@kestrel.ai",
    company: "Kestrel AI",
    campaignIdx: 2,
    mailboxIdx: 6,
    subject: "Re: Quick question about Kestrel AI's outbound",
    preview: "Send the teardown. No promises, but we've been unhappy with our current agency.",
    folder: "primary",
    statusId: 9,
    minutesAgo: 240,
    unread: false,
    starred: true,
    reminder: false,
  },
  {
    name: "Chloe Dubois",
    email: "chloe.dubois@palewood.com",
    company: "Palewood",
    campaignIdx: 2,
    mailboxIdx: 6,
    subject: "Re: Quick question about Palewood's outbound",
    preview: "We're all set on outbound for now. Please remove me from your list.",
    folder: "primary",
    statusId: 5,
    minutesAgo: 360,
    unread: false,
    starred: false,
    reminder: false,
  },
  {
    name: "Marcus Walsh",
    email: "marcus.walsh@driftworks.io",
    company: "Driftworks",
    campaignIdx: 0,
    mailboxIdx: 2,
    subject: "Re: Quick question about Driftworks' outbound",
    preview: "What's your pricing model? We run about 15k emails a month across six domains.",
    folder: "primary",
    statusId: 1,
    minutesAgo: 520,
    unread: false,
    starred: false,
    reminder: true,
  },
  {
    name: "Priya Nair",
    email: "priya.nair@tidewater.co",
    company: "Tidewater",
    campaignIdx: 1,
    mailboxIdx: 5,
    subject: "Re: Quick question about Tidewater's outbound",
    preview: "Interesting. We're a 40-person team and our current setup is Gmail plus a spreadsheet. What would this look like for us?",
    folder: "unread",
    statusId: 1,
    minutesAgo: 40,
    unread: true,
    starred: false,
    reminder: false,
  },
  {
    name: "Liam O'Connor",
    email: "liam.oconnor@lumenhealth.com",
    company: "Lumen Health",
    campaignIdx: 0,
    mailboxIdx: 0,
    subject: "Re: Quick question about Lumen Health's outbound",
    preview: "Who is this and how did you get my email address?",
    folder: "primary",
    statusId: 5,
    minutesAgo: 1440,
    unread: false,
    starred: false,
    reminder: false,
  },
  {
    name: "Nora Lindqvist",
    email: "nora.lindqvist@ironvale.dev",
    company: "Ironvale",
    campaignIdx: 4,
    mailboxIdx: 4,
    subject: "Re: Quick question about Ironvale's outbound",
    preview: "Yes — 20 minutes next Tuesday works. Send an invite.",
    folder: "primary",
    statusId: 2,
    minutesAgo: 1800,
    unread: false,
    starred: false,
    reminder: false,
  },
  {
    name: "Owen Hayes",
    email: "owen.hayes@quarrysoft.com",
    company: "Quarry Software",
    campaignIdx: 1,
    mailboxIdx: 3,
    subject: "Re: Quick question about Quarry Software's outbound",
    preview: "Forwarded to my colleague Aisha who handles this. She'll reach out.",
    folder: "others",
    statusId: 10,
    minutesAgo: 2600,
    unread: false,
    starred: false,
    reminder: false,
  },
  {
    name: "Isabel Moreau",
    email: "isabel.moreau@meridianops.co",
    company: "Meridian Ops",
    campaignIdx: 2,
    mailboxIdx: 6,
    subject: "Re: Quick question about Meridian Ops' outbound",
    preview: "Thanks but we just signed a 12-month contract with another provider. Revisit us next year.",
    folder: "primary",
    statusId: 5,
    minutesAgo: 3100,
    unread: false,
    starred: false,
    reminder: false,
  },
];

export const conversations: Conversation[] = conversationSeeds.map((seed, i) => {
  const campaign = campaigns[seed.campaignIdx] as Campaign;
  const mailbox = mailboxes[seed.mailboxIdx] as Mailbox;
  return {
    id: `cnv_${i + 1}`,
    leadId: `led_${(i % leads.length) + 1}`,
    leadEmail: seed.email,
    leadName: seed.name,
    company: seed.company,
    campaignId: campaign.id,
    campaignName: campaign.name,
    mailboxId: mailbox.id,
    mailboxEmail: mailbox.email,
    subject: seed.subject,
    preview: seed.preview,
    folder: seed.folder,
    statusId: seed.statusId,
    isRead: !seed.unread,
    isStarred: seed.starred,
    lastMessageAt: iso(seed.minutesAgo * MINUTE),
    messageCount: 3 + (i % 4),
    hasReminder: seed.reminder,
  };
});

export const messagesByConversation = new Map<string, Message[]>();

/**
 * Sent mail must never show a raw merge token. Templates in the builder keep
 * their `{{variables}}`; anything rendered as a delivered message substitutes
 * against the lead's actual data.
 */
function renderForLead(
  body: string,
  lead: { firstName: string | null; company: string | null } | undefined,
): string {
  return body
    .replace(/\{\{first_name\}\}/g, lead?.firstName ?? "there")
    .replace(/\{\{company\}\}/g, lead?.company ?? "your team")
    .replace(/\{\{industry\}\}/g, "B2B SaaS")
    .replace(/\{\{last_name\}\}/g, "")
    .replace(/\{\{title\}\}/g, "Head of Growth")
    .replace(/\{\{\w+\}\}/g, "");
}

for (const [i, conv] of conversations.entries()) {
  const seed = conversationSeeds[i] as ConversationSeed;
  const steps = campaignSteps.get(conv.campaignId) ?? [];
  const first = steps[0];
  const leadForConv = {
    firstName: seed.name.split(" ")[0] ?? null,
    company: seed.company,
  };

  const thread: Message[] = [
    {
      id: `${conv.id}_m1`,
      conversationId: conv.id,
      direction: "outbound",
      fromName: "Sarah Whitfield",
      fromEmail: conv.mailboxEmail,
      toEmail: conv.leadEmail,
      subject: renderForLead(
        first?.variants[0]?.subject?.replace(/^Re:\s*/, "") ?? "Quick question",
        leadForConv,
      ),
      body: renderForLead(
        first?.bodyHtml ??
          "Hi {{first_name}},\n\nQuick question about your outbound setup.\n\n— Sarah",
        leadForConv,
      ),
      createdAt: iso((seed.minutesAgo + 4300) * MINUTE),
      isAutoReply: false,
      stepLabel: "Step 1 · A",
    },
    {
      id: `${conv.id}_m2`,
      conversationId: conv.id,
      direction: "outbound",
      fromName: "Sarah Whitfield",
      fromEmail: conv.mailboxEmail,
      toEmail: conv.leadEmail,
      subject: conv.subject,
      body: renderForLead(
        steps[1]?.bodyHtml ??
          "Hi {{first_name}},\n\nFollowing up on my note last week.\n\n— Sarah",
        leadForConv,
      ),
      createdAt: iso((seed.minutesAgo + 1400) * MINUTE),
      isAutoReply: false,
      stepLabel: "Step 2 · A",
    },
    {
      id: `${conv.id}_m3`,
      conversationId: conv.id,
      direction: "inbound",
      fromName: seed.name,
      fromEmail: seed.email,
      toEmail: conv.mailboxEmail,
      subject: conv.subject,
      body: seed.preview,
      createdAt: iso(seed.minutesAgo * MINUTE),
      isAutoReply: seed.statusId === 7,
      stepLabel: null,
    },
  ];

  messagesByConversation.set(conv.id, thread);
}

/* ------------------------------------------------------------------------- */
/* Activities                                                                 */
/* ------------------------------------------------------------------------- */

const activityTypes: ActivityType[] = [
  "email_sent", "email_sent", "email_sent", "email_opened", "email_opened",
  "link_clicked", "reply_received", "auto_reply", "bounced", "status_changed",
];

export const activities: Activity[] = Array.from({ length: 120 }, (_, i) => {
  const type = pick(activityTypes);
  const campaign = campaigns[i % campaigns.length] as Campaign;
  const lead = leads[i % leads.length] as Lead;
  const mailbox = mailboxes[i % mailboxes.length] as Mailbox;
  const stepLabel = `Step ${1 + (i % 4)} · A`;

  return {
    id: `act_${i + 1}`,
    type,
    campaignId: campaign.id,
    campaignName: campaign.name,
    leadEmail: lead.email,
    mailboxEmail: mailbox.email,
    stepLabel: type === "status_changed" ? null : stepLabel,
    linkUrl:
      type === "link_clicked"
        ? "https://getacme.io/pricing"
        : null,
    createdAt: iso(between(1, 7200) * MINUTE),
  };
}).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

/* ------------------------------------------------------------------------- */
/* Opportunities                                                              */
/* ------------------------------------------------------------------------- */

export const opportunities: Opportunity[] = [
  { lead: "Daniel Chen", email: "daniel.chen@northwindlabs.com", company: "Northwind Labs", campaignIdx: 0, status: "Interested", value: 4_800_00 },
  { lead: "Megan Murphy", email: "megan.murphy@cobalt.systems", company: "Cobalt Systems", campaignIdx: 0, status: "Meeting Booked", value: 12_000_00 },
  { lead: "Ethan Brooks", email: "ethan.brooks@kestrel.ai", company: "Kestrel AI", campaignIdx: 2, status: "Wants a demo", value: 7_200_00 },
  { lead: "Nora Lindqvist", email: "nora.lindqvist@ironvale.dev", company: "Ironvale", campaignIdx: 4, status: "Meeting Booked", value: 18_500_00 },
  { lead: "Priya Nair", email: "priya.nair@tidewater.co", company: "Tidewater", campaignIdx: 1, status: "Interested", value: 3_600_00 },
  { lead: "Marcus Walsh", email: "marcus.walsh@driftworks.io", company: "Driftworks", campaignIdx: 0, status: "Meeting Completed", value: 24_000_00 },
].map((o, i) => ({
  id: `opp_${i + 1}`,
  leadId: `led_${i + 1}`,
  leadEmail: o.email,
  company: o.company,
  campaignId: (campaigns[o.campaignIdx] as Campaign).id,
  status: o.status,
  valueMinor: o.value,
  currency: "USD",
  createdAt: iso((i * 3 + 2) * DAY),
}));

/* ------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* ------------------------------------------------------------------------- */

function buildTrend(days: number): DailyPoint[] {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(NOW - (days - 1 - i) * DAY);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const base = weekend ? 40 : 320;
    const sent = Math.round(base * (0.75 + rand() * 0.5));
    const opened = Math.round(sent * (0.38 + rand() * 0.15));
    const replied = Math.round(sent * (0.021 + rand() * 0.03));
    const bounced = Math.round(sent * (0.004 + rand() * 0.012));
    return {
      date: date.toISOString().slice(0, 10),
      sent,
      opened,
      replied,
      bounced,
    };
  });
}

const trend = buildTrend(30);
const today = trend[trend.length - 1] as DailyPoint;
const totalSent = trend.reduce((sum, d) => sum + d.sent, 0);
const totalReplied = trend.reduce((sum, d) => sum + d.replied, 0);
const totalBounced = trend.reduce((sum, d) => sum + d.bounced, 0);

export const dashboard: DashboardSummary = {
  sentToday: today.sent,
  repliesToday: today.replied,
  opportunities: opportunities.length,
  opportunityValue: opportunities.reduce((sum, o) => sum + o.valueMinor, 0),
  activeCampaigns: campaigns.filter((c) => c.status === "active").length,
  connectedMailboxes: mailboxes.filter((m) => m.status === "connected").length,
  unhealthyMailboxes: mailboxes.filter(
    (m) => m.status === "degraded" || m.status === "failed",
  ).length,
  bounceRate: (totalBounced / totalSent) * 100,
  replyRate: (totalReplied / totalSent) * 100,
  trend,
};

export const analyticsTrend = trend;
