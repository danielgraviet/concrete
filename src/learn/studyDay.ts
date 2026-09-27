/** Like Anki, a study day rolls over at 4am local time, not midnight. */
const ROLLOVER_HOURS = 4;

function shifted(now: number): Date {
  return new Date(now - ROLLOVER_HOURS * 3600_000);
}

export function studyDay(now: number): string {
  const d = shifted(now);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Epoch ms when the current study day ends (the next 4am). */
export function studyDayEnd(now: number): number {
  const d = shifted(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.getTime() + ROLLOVER_HOURS * 3600_000;
}
