/** Same list as the reports.reason check in supabase/migrations/0003_cloud.sql. Used for communities and DMs. */
export const REPORT_REASONS: [string, string][] = [
  ["spam", "Spam or scams"],
  ["harassment", "Harassment or bullying"],
  ["hate", "Hate speech"],
  ["violence", "Threats or violence"],
  ["sexual", "Sexual content involving minors, or shared without consent"],
  ["illegal", "Something else illegal"],
  ["impersonation", "Pretending to be someone else"],
  ["other", "Something else"],
];
