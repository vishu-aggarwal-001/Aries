import { MODELS, State, Agent, createTask, emptyState, newId, now } from "./model.ts";

interface Seat { name: string; title: string; role: string; emoji: string; model?: string; instructions?: string }
export interface Template { key: string; label: string; blurb: string; goalHint: string; ceo: Seat; team: Seat[]; suggests: string[] }

const SUPPORT: Seat = { name: "June", title: "Customer Support Lead", role: "Answers customer questions, handles order issues and returns, keeps a friendly brand voice. Drafts replies and sends them through the business's email connection when allowed.", emoji: "💬" };
const OPS: Seat = { name: "Otto", title: "Operations Manager", role: "Owns fulfillment: watches new orders, buys shipping labels within the spending rules, marks orders fulfilled with tracking, flags stock problems.", emoji: "📦", model: MODELS.sonnet };
const MARKETER: Seat = { name: "Max", title: "Marketing Lead", role: "Owns growth: campaigns, promotions, social and email copy, product descriptions, and measuring what works.", emoji: "📣" };
const MERCH: Seat = { name: "Mira", title: "Merchandiser", role: "Owns the catalog: pricing, product copy, inventory levels, restock plans and bundles.", emoji: "🏷️" };

export const TEMPLATES: Template[] = [
  {
    key: "store", label: "Online store", blurb: "Ecommerce on Shopify, WooCommerce or anything else. Orders get shipped, customers get answers.",
    goalHint: "Ship every order within 24 hours, answer customers same day, and grow monthly revenue 20%",
    ceo: { name: "Ada", title: "CEO", role: "Runs the business toward the goal, sets priorities, delegates and reports to the owner.", emoji: "🧭", model: MODELS.sonnet },
    team: [OPS, SUPPORT, MARKETER, MERCH], suggests: ["shopify", "woocommerce", "shippo", "email", "stripe"],
  },
  {
    key: "maker", label: "Maker / handmade", blurb: "Small-batch products sold online or at markets.",
    goalHint: "Keep the shop stocked, ship within 2 days, and launch one new product a month",
    ceo: { name: "Ada", title: "Studio Manager", role: "Keeps the studio running: priorities, launches, and the owner's time.", emoji: "🧭", model: MODELS.sonnet },
    team: [OPS, SUPPORT, MARKETER], suggests: ["shopify", "shippo", "email", "webhook"],
  },
  {
    key: "services", label: "Services business", blurb: "Agencies, consultants, trades, studios and clinics that sell time and expertise.",
    goalHint: "Respond to every lead within an hour, keep the calendar 80% booked, and get paid on time",
    ceo: { name: "Ada", title: "General Manager", role: "Runs the business: pipeline, delivery quality, cash flow.", emoji: "🧭", model: MODELS.sonnet },
    team: [
      { name: "Sol", title: "Sales Lead", role: "Qualifies leads, writes proposals and follow-ups, keeps the pipeline moving.", emoji: "🤝" },
      { name: "June", title: "Client Success", role: "Onboards clients, answers questions, collects feedback and reviews.", emoji: "💬" },
      { name: "Otto", title: "Operations & Billing", role: "Scheduling, invoices and payment links, overdue reminders.", emoji: "🗂️" },
      MARKETER,
    ], suggests: ["stripe", "email", "mcp", "webhook"],
  },
  {
    key: "local", label: "Restaurant, café or shop", blurb: "Local businesses with walk-in customers, suppliers and staff schedules.",
    goalHint: "Grow weekday covers 15%, keep reviews above 4.6 stars, and never run out of top sellers",
    ceo: { name: "Ada", title: "General Manager", role: "Runs day-to-day priorities and reports to the owner.", emoji: "🧭", model: MODELS.sonnet },
    team: [
      { name: "Otto", title: "Operations & Inventory", role: "Supplier orders, stock counts, waste, prep lists.", emoji: "📋" },
      { name: "June", title: "Guest Relations", role: "Replies to reviews and messages, handles bookings and complaints.", emoji: "⭐" },
      MARKETER,
    ], suggests: ["email", "webhook", "mcp", "api"],
  },
  {
    key: "software", label: "Software / SaaS", blurb: "Product companies with users, support tickets and launches.",
    goalHint: "Cut support response time under 2 hours and ship a launch plan for the next release",
    ceo: { name: "Ada", title: "CEO", role: "Owns the roadmap, priorities and the owner's updates.", emoji: "🧭", model: MODELS.sonnet },
    team: [
      { name: "Linus", title: "CTO", role: "Specs, technical decisions, bug triage, code in documents.", emoji: "🛠️", model: MODELS.sonnet },
      { name: "June", title: "Support Lead", role: "Answers users, writes help docs, spots patterns in tickets.", emoji: "💬" },
      { name: "Max", title: "Growth Lead", role: "Positioning, launches, onboarding emails, pricing tests.", emoji: "📈" },
    ], suggests: ["stripe", "email", "mcp", "api"],
  },
  {
    key: "creator", label: "Creator / media", blurb: "Newsletters, courses, channels and publishing.",
    goalHint: "Publish weekly, grow the list 10% a month, and launch one paid product",
    ceo: { name: "Ada", title: "Editor-in-Chief", role: "Sets the editorial calendar and quality bar.", emoji: "🧭", model: MODELS.sonnet },
    team: [
      { name: "Sage", title: "Researcher", role: "Finds angles, facts and sources.", emoji: "🔎" },
      { name: "Quill", title: "Writer", role: "Turns briefs into finished drafts in the brand voice.", emoji: "✍️", model: MODELS.sonnet },
      { name: "Echo", title: "Social Lead", role: "Cuts each piece into posts and schedules them.", emoji: "📱" },
    ], suggests: ["stripe", "email", "webhook", "mcp"],
  },
  {
    key: "custom", label: "Start from scratch", blurb: "Just a CEO. It proposes each hire and you approve.",
    goalHint: "", ceo: { name: "Ada", title: "CEO", role: "Turns the goal into a plan, hires the right agents, delegates.", emoji: "🧭", model: MODELS.sonnet },
    team: [], suggests: ["mcp", "api", "webhook"],
  },
];

const mkAgent = (seat: Seat, reportsTo: string | null, budget: number, hue: number): Agent => ({
  id: newId(), name: seat.name, title: seat.title, role: seat.role, reportsTo, model: seat.model ?? MODELS.haiku,
  instructions: seat.instructions ?? "", budgetUsd: budget, spentUsd: 0, heartbeatMin: reportsTo ? 45 : 60, paused: false,
  lastHeartbeat: 0, wake: false, wakeReason: "", emoji: seat.emoji, hue, runs: 0, tasksDone: 0, createdAt: now(),
});

export function foundState(name: string, goal: string, templateKey: string, monthlyBudget: number, ownerNotes = ""): State {
  const t = TEMPLATES.find(x => x.key === templateKey) ?? TEMPLATES[TEMPLATES.length - 1];
  const s = emptyState(name.trim(), goal.trim(), t.key);
  s.settings.monthlyAgentBudgetUsd = monthlyBudget;
  const ceo = mkAgent(t.ceo, null, Math.max(1, monthlyBudget * 0.3), 38);
  s.agents.push(ceo, ...t.team.map((seat, i) => mkAgent(seat, ceo.id, Math.max(0.5, monthlyBudget * 0.15), (90 + i * 67) % 360)));
  createTask(s, {
    title: `Get ${s.name} running: plan for "${goal.trim().slice(0, 100)}"`,
    description:
      `You are the ${ceo.title}. Business type: ${t.label}.${ownerNotes ? `\nOwner notes: ${ownerNotes}` : ""}\n\n` +
      `1. Write a short operating plan (write_document key "plan"): 3–5 priorities with measurable outcomes and who owns each.\n` +
      `2. Check which apps are connected (list_connections). If something important is missing (store, payments, shipping, email), tell the board exactly what to connect in a comment.\n` +
      `3. Create the first tasks for the team` + (t.team.length ? `, assigned to the best fit.` : `, and request the hires you need.`) +
      `\n4. Submit the plan for board review.`,
    assigneeId: ceo.id, priority: "high", createdBy: "system",
  });
  s.routines.push({
    id: newId(), title: "Daily brief", everyHours: 24, lastRun: now(), enabled: true, assigneeId: ceo.id,
    description: "Write today's brief for the owner (write_document key \"daily-brief\"): what got done, orders and revenue, anything waiting on the owner, and today's priorities. Keep it under 250 words. Mark the task done when written.",
  });
  return s;
}
