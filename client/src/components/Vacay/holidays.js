// German public holidays (Feiertage) calculation per Bundesland
// Includes fixed and Easter-dependent movable holidays

const BUNDESLAENDER = {
  BW: 'Baden-Württemberg',
  BY: 'Bayern',
  BE: 'Berlin',
  BB: 'Brandenburg',
  HB: 'Bremen',
  HH: 'Hamburg',
  HE: 'Hessen',
  MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen',
  NW: 'Nordrhein-Westfalen',
  RP: 'Rheinland-Pfalz',
  SL: 'Saarland',
  SN: 'Sachsen',
  ST: 'Sachsen-Anhalt',
  SH: 'Schleswig-Holstein',
  TH: 'Thüringen',
};

// Gauss Easter algorithm
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function fmt(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getHolidays(year, bundesland = 'NW') {
  const easter = easterSunday(year);
  const holidays = {};

  // Fixed holidays (nationwide)
  holidays[`${year}-01-01`] = 'Neujahr';
  holidays[`${year}-05-01`] = 'Tag der Arbeit';
  holidays[`${year}-10-03`] = 'Tag der Deutschen Einheit';
  holidays[`${year}-12-25`] = '1. Weihnachtsfeiertag';
  holidays[`${year}-12-26`] = '2. Weihnachtsfeiertag';

  // Easter-dependent (nationwide)
  holidays[fmt(addDays(easter, -2))] = 'Karfreitag';
  holidays[fmt(addDays(easter, 1))] = 'Ostermontag';
  holidays[fmt(addDays(easter, 39))] = 'Christi Himmelfahrt';
  holidays[fmt(addDays(easter, 50))] = 'Pfingstmontag';

  // State-specific
  const bl = bundesland.toUpperCase();

  // Heilige Drei Könige (6. Jan) — BW, BY, ST
  if (['BW', 'BY', 'ST'].includes(bl)) {
    holidays[`${year}-01-06`] = 'Heilige Drei Könige';
  }

  // Internationaler Frauentag (8. März) — BE, MV
  if (['BE', 'MV'].includes(bl)) {
    holidays[`${year}-03-08`] = 'Internationaler Frauentag';
  }

  // Fronleichnam — BW, BY, HE, NW, RP, SL, SN (teilweise), TH (teilweise)
  if (['BW', 'BY', 'HE', 'NW', 'RP', 'SL'].includes(bl)) {
    holidays[fmt(addDays(easter, 60))] = 'Fronleichnam';
  }

  // Mariä Himmelfahrt (15. Aug) — SL, BY (teilweise)
  if (['SL'].includes(bl)) {
    holidays[`${year}-08-15`] = 'Mariä Himmelfahrt';
  }

  // Weltkindertag (20. Sep) — TH
  if (bl === 'TH') {
    holidays[`${year}-09-20`] = 'Weltkindertag';
  }

  // Reformationstag (31. Okt) — BB, HB, HH, MV, NI, SN, ST, SH, TH
  if (['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'].includes(bl)) {
    holidays[`${year}-10-31`] = 'Reformationstag';
  }

  // Allerheiligen (1. Nov) — BW, BY, NW, RP, SL
  if (['BW', 'BY', 'NW', 'RP', 'SL'].includes(bl)) {
    holidays[`${year}-11-01`] = 'Allerheiligen';
  }

  // Buß- und Bettag — SN (Mittwoch vor dem 23. November)
  if (bl === 'SN') {
    const nov23 = new Date(year, 10, 23);
    let bbt = new Date(nov23);
    while (bbt.getDay() !== 3) bbt.setDate(bbt.getDate() - 1);
    holidays[fmt(bbt)] = 'Buß- und Bettag';
  }

  return holidays;
}

export function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  return day === 0 || day === 6;
}

export function getWeekday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
}

export function getWeekdayFull(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][d.getDay()];
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export { BUNDESLAENDER };
