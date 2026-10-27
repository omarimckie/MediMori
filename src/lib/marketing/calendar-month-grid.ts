import {
  dayKeyFromYmd,
  marketingDatetimeLocalToIso,
  marketingWeekdaySunday0,
  marketingZonedYmd,
} from "./marketing-scheduling";

export type CalendarMonthCell = {
  dayKey: string;
  day: number;
  inCurrentMonth: boolean;
};

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  let y = year;
  let m = month + delta;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return { year: y, month: m };
}

function noonIsoForLocalDay(year: number, month: number, day: number, timeZone: string): string {
  const local = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00`;
  return marketingDatetimeLocalToIso(local, timeZone);
}

/** Build a 7-column month grid (Sun–Sat) with leading/trailing days. */
export function buildCalendarMonthCells(
  viewYear: number,
  viewMonth: number,
  timeZone: string,
): CalendarMonthCell[] {
  const firstIso = noonIsoForLocalDay(viewYear, viewMonth, 1, timeZone);
  const startWeekday = marketingWeekdaySunday0(firstIso, timeZone);
  const monthLength = daysInMonth(viewYear, viewMonth);

  const cells: CalendarMonthCell[] = [];

  if (startWeekday > 0) {
    const prev = addMonths(viewYear, viewMonth, -1);
    const prevLength = daysInMonth(prev.year, prev.month);
    for (let i = startWeekday - 1; i >= 0; i -= 1) {
      const day = prevLength - i;
      cells.push({
        dayKey: dayKeyFromYmd(prev.year, prev.month, day),
        day,
        inCurrentMonth: false,
      });
    }
  }

  for (let day = 1; day <= monthLength; day += 1) {
    cells.push({
      dayKey: dayKeyFromYmd(viewYear, viewMonth, day),
      day,
      inCurrentMonth: true,
    });
  }

  const nextMonth = addMonths(viewYear, viewMonth, 1);
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({
      dayKey: dayKeyFromYmd(nextMonth.year, nextMonth.month, nextDay),
      day: nextDay,
      inCurrentMonth: false,
    });
    nextDay += 1;
  }

  return cells;
}

export function currentMarketingMonth(timeZone: string): { year: number; month: number } {
  const { year, month } = marketingZonedYmd(new Date(), timeZone);
  return { year, month };
}

export function shiftMarketingMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  return addMonths(year, month, delta);
}

export function monthYearLabel(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    date,
  );
}
