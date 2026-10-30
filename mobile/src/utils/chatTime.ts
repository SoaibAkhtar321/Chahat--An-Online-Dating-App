/** Chat list timestamp: "14:05" today, "Yesterday", weekday within a week, otherwise "12 Oct" / "12 Oct 2025". */
export function formatChatListTime(at: number, now: number = Date.now()): string {
  const d = new Date(at);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (at >= startOfToday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (at >= startOfToday - day) return "Yesterday";
  if (at >= startOfToday - 6 * day) return d.toLocaleDateString("en-IN", { weekday: "short" });
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}
