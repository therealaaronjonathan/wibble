// The soul of v1. A rotating bank of warm, one-sentence messages.
// Selection is deterministic per local day, so the same message shows all day
// and is stable across reopens (date-keyed without needing a write).
//
// Tone is tuned directly with the real user; edit freely.
const MESSAGES: string[] = [
  "Good morning, {name}. Managing this every single day is hard, and you do it anyway.",
  "Hey {name} — whatever your numbers say today, you're doing better than you think.",
  "{name}, you carry something most people never see. That takes real strength.",
  "Morning, {name}. One reading at a time. You've got today.",
  "{name}, the effort you put in every day matters, even when no one's watching.",
  "Hi {name}. Diabetes doesn't get a day off, and neither does your courage.",
  "{name}, you're not your numbers. You're the person showing up for them.",
  "Good morning, {name}. Be gentle with yourself today — you're doing enough.",
  "{name}, every check-in is you taking care of you. That's worth something.",
  "Hey {name}, rough days happen and they pass. You're still here, still trying.",
];

// yyyy-mm-dd in LOCAL time — the key the day's message hangs on.
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function messageForToday(name: string, dateKey = localDateKey()): string {
  const idx = hashString(dateKey) % MESSAGES.length;
  const first = (name || "").trim().split(/\s+/)[0] || "you";
  return MESSAGES[idx].replace(/\{name\}/g, first);
}
