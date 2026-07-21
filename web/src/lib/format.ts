export const formatTokens = (value: number) =>
  new Intl.NumberFormat("en", { notation: value >= 100000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);

export const formatNumber = (value: number | null) => (value === null ? "Unavailable" : value.toLocaleString());

export const relativeTime = (iso: string) => {
  const timestamp = new Date(iso).getTime();
  if (!iso || !Number.isFinite(timestamp)) return "Unavailable";
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
};

export const titleCase = (value: string) => value.replace(/(^|[-_ ])\w/g, (match) => match.toUpperCase()).replaceAll("_", "-");
