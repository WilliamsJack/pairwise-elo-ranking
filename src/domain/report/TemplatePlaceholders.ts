import type { CohortData, SessionMatchData, UndoFrame } from '../../types';
import { computeSurprise, expectedScore } from '../rating/GlickoEngine';

export function formatDateParts(d: Date): {
  dateStr: string;
  datetimeStr: string;
  datetimeFileStr: string;
} {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');

  const dateStr = `${yyyy}-${mm}-${dd}`;
  const datetimeStr = `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  const datetimeFileStr = `${yyyy}-${mm}-${dd} ${hh}${mi}${ss}`;
  return { dateStr, datetimeStr, datetimeFileStr };
}

export function resolveReportFileName(
  nameTemplate: string,
  cohortLabel: string,
  matchCount: number,
  now: Date,
): string {
  const { dateStr, datetimeFileStr } = formatDateParts(now);

  return nameTemplate
    .replace(/\{\{cohort\}\}/g, cohortLabel)
    .replace(/\{\{datetime\}\}/g, datetimeFileStr)
    .replace(/\{\{date\}\}/g, dateStr)
    .replace(/\{\{count\}\}/g, String(matchCount));
}

export function computePlaceholders(
  data: SessionMatchData,
  cohort: CohortData | undefined,
  cohortLabel: string,
  now: Date,
): Record<string, string> {
  const matchCount = data.matches.length;

  const { dateStr, datetimeStr } = formatDateParts(now);

  // Collect stats from matches
  const uniquePlayerIds = new Set<string>();
  let draws = 0;
  const newEntrants = new Set<string>();
  const firstSeen = new Map<string, UndoFrame>();

  for (const m of data.matches) {
    uniquePlayerIds.add(m.a.id);
    uniquePlayerIds.add(m.b.id);
    if (m.result === 'D') draws++;

    if (!firstSeen.has(m.a.id)) {
      firstSeen.set(m.a.id, m);
      if (m.a.matches === 0) newEntrants.add(m.a.id);
    }
    if (!firstSeen.has(m.b.id)) {
      firstSeen.set(m.b.id, m);
      if (m.b.matches === 0) newEntrants.add(m.b.id);
    }
  }

  const drawRate = matchCount > 0 ? ((draws / matchCount) * 100).toFixed(0) : '0';

  // Session duration
  const endTs = matchCount > 0 ? data.matches[matchCount - 1].ts : now.getTime();
  const durationMs = Math.max(0, endTs - data.startedAt);
  const durationStr = formatDuration(durationMs);

  // Rating changes
  const preSessionRating = new Map<string, number>();
  const postSessionRating = new Map<string, number>();

  for (const m of data.matches) {
    if (!preSessionRating.has(m.a.id)) preSessionRating.set(m.a.id, m.a.rating);
    if (!preSessionRating.has(m.b.id)) preSessionRating.set(m.b.id, m.b.rating);
  }

  if (cohort) {
    for (const id of uniquePlayerIds) {
      const p = cohort.players[id];
      if (p) postSessionRating.set(id, p.rating);
    }
  }

  const ratingChanges: { id: string; change: number; pre: number; post: number }[] = [];
  for (const id of uniquePlayerIds) {
    const pre = preSessionRating.get(id) ?? 1500;
    const post = postSessionRating.get(id) ?? pre;
    ratingChanges.push({ id, change: post - pre, pre, post });
  }

  ratingChanges.sort((a, b) => b.change - a.change);

  // Gains list (all gains, sorted largest first)
  const gainsList = ratingChanges
    .filter((r) => r.change > 0)
    .map((g) => {
      const name = idToName(g.id, data.idToPath);
      return `- ${name} +${Math.round(g.change)} (${Math.round(g.pre)} → ${Math.round(g.post)})`;
    })
    .join('\n');

  // Losses list (all losses, sorted largest loss first)
  const lossesList = ratingChanges
    .filter((r) => r.change < 0)
    .reverse()
    .map((l) => {
      const name = idToName(l.id, data.idToPath);
      return `- ${name} ${Math.round(l.change)} (${Math.round(l.pre)} → ${Math.round(l.post)})`;
    })
    .join('\n');

  // Surprises list (all surprising results, sorted most surprising first)
  const surprises: { frame: UndoFrame; surprise: number; winnerExpected: number }[] = [];
  for (const m of data.matches) {
    const s = computeSurprise(m.a.rating, m.b.rating, m.result);
    const E = expectedScore(m.a.rating, m.b.rating);
    const winnerExpected = m.result === 'A' ? E : m.result === 'B' ? 1 - E : 0;
    surprises.push({ frame: m, surprise: s, winnerExpected });
  }
  surprises.sort((a, b) => b.surprise - a.surprise);

  const surprisesList = surprises
    .filter((s) => s.surprise > 0)
    .map((u) => {
      const f = u.frame;
      const ratingA = Math.round(f.a.rating);
      const ratingB = Math.round(f.b.rating);
      if (f.result === 'D') {
        const nameA = idToName(f.a.id, data.idToPath);
        const nameB = idToName(f.b.id, data.idToPath);
        return `- ${nameA} (${ratingA}) drew ${nameB} (${ratingB})`;
      } else {
        const winnerId = f.result === 'A' ? f.a.id : f.b.id;
        const loserId = f.result === 'A' ? f.b.id : f.a.id;
        const winnerRating = f.result === 'A' ? ratingA : ratingB;
        const loserRating = f.result === 'A' ? ratingB : ratingA;
        const winner = idToName(winnerId, data.idToPath);
        const loser = idToName(loserId, data.idToPath);
        return `- ${winner} (${winnerRating}) beat ${loser} (${loserRating}) (${(u.winnerExpected * 100).toFixed(0)}% expected)`;
      }
    })
    .join('\n');

  // Match log (chronological sequence of results)
  const matchLog = data.matches
    .map((m) => {
      const nameA = idToName(m.a.id, data.idToPath);
      const nameB = idToName(m.b.id, data.idToPath);
      if (m.result === 'D') return `- ${nameA} drew ${nameB}`;
      const winner = m.result === 'A' ? nameA : nameB;
      const loser = m.result === 'A' ? nameB : nameA;
      return `- ${winner} beat ${loser}`;
    })
    .join('\n');

  // New entrants list
  const newEntrantsList = [...newEntrants]
    .map((id) => `- ${idToName(id, data.idToPath)}`)
    .join('\n');

  // Sigma-based stats (stability)
  const preSessionSigma = new Map<string, number>();
  for (const m of data.matches) {
    if (!preSessionSigma.has(m.a.id) && m.a.sigma != null) preSessionSigma.set(m.a.id, m.a.sigma);
    if (!preSessionSigma.has(m.b.id) && m.b.sigma != null) preSessionSigma.set(m.b.id, m.b.sigma);
  }

  // Stability lists and leaderboard — session-scoped and cohort-wide variants
  let mostStableList = '';
  let leastStableList = '';
  let mostStableListAll = '';
  let leastStableListAll = '';
  let stabilityDelta = '';
  let leaderboardTable = '';
  let leaderboardTableAll = '';

  if (cohort) {
    const allWithSigma = Object.entries(cohort.players)
      .filter(([, p]) => p.sigma != null)
      .map(([id, p]) => ({ id, sigma: p.sigma! }));

    const sessionWithSigma = allWithSigma.filter(({ id }) => uniquePlayerIds.has(id));

    const formatStabilityList = (entries: { id: string; sigma: number }[]) =>
      entries
        .map((e) => `- ${idToName(e.id, data.idToPath)} (σ ${Math.round(e.sigma)})`)
        .join('\n');

    // Session participants only
    const byStabilitySession = sessionWithSigma.slice().sort((a, b) => a.sigma - b.sigma);
    mostStableList = formatStabilityList(byStabilitySession);
    leastStableList = formatStabilityList(byStabilitySession.slice().reverse());

    // Cohort-wide
    const byStabilityAll = allWithSigma.slice().sort((a, b) => a.sigma - b.sigma);
    mostStableListAll = formatStabilityList(byStabilityAll);
    leastStableListAll = formatStabilityList(byStabilityAll.slice().reverse());

    // Stability delta: average sigma decrease for session participants
    let totalDelta = 0;
    let count = 0;
    for (const id of uniquePlayerIds) {
      const pre = preSessionSigma.get(id);
      const post = cohort.players[id]?.sigma;
      if (pre != null && post != null) {
        totalDelta += pre - post; // positive = became more stable
        count++;
      }
    }
    if (count > 0) {
      const avg = totalDelta / count;
      const sign = avg >= 0 ? '+' : '';
      stabilityDelta = `${sign}${avg.toFixed(1)}σ avg across ${count} notes`;
    }

    // Leaderboard tables
    const buildLeaderboard = (entries: { id: string; rating: number; sigma?: number }[]) => {
      if (entries.length === 0) return '';
      const rows: string[] = [];
      rows.push('| Rank | Note | Rating |');
      rows.push('|------|------|--------|');
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const name = idToName(e.id, data.idToPath);
        const sigma = e.sigma != null ? ` (σ ${Math.round(e.sigma)})` : '';
        rows.push(`| ${i + 1} | ${name} | ${Math.round(e.rating)}${sigma} |`);
      }
      return rows.join('\n');
    };

    const sessionEntries = Object.entries(cohort.players)
      .filter(([id]) => uniquePlayerIds.has(id))
      .map(([id, p]) => ({ id, rating: p.rating, sigma: p.sigma }))
      .sort((a, b) => b.rating - a.rating);

    const allEntries = Object.entries(cohort.players)
      .map(([id, p]) => ({ id, rating: p.rating, sigma: p.sigma }))
      .sort((a, b) => b.rating - a.rating);

    leaderboardTable = buildLeaderboard(sessionEntries);
    leaderboardTableAll = buildLeaderboard(allEntries);
  }

  return {
    'glicko:cohort': cohortLabel,
    'glicko:date': dateStr,
    'glicko:datetime': datetimeStr,
    'glicko:duration': durationStr,
    'glicko:match-count': String(matchCount),
    'glicko:unique-players': String(uniquePlayerIds.size),
    'glicko:draw-rate': `${drawRate}%`,
    'glicko:new-entrants': String(newEntrants.size),
    'glicko:file-count': String(data.fileCount),
    'glicko:stability-delta': stabilityDelta || 'No stability data.',
    'glicko:gains-list': gainsList || 'No rating gains this session.',
    'glicko:losses-list': lossesList || 'No rating losses this session.',
    'glicko:match-log': matchLog || 'No matches this session.',
    'glicko:surprises-list': surprisesList || 'No surprising results.',
    'glicko:new-entrants-list': newEntrantsList || 'No new entrants this session.',
    'glicko:most-stable-list': mostStableList || 'No stability data available.',
    'glicko:least-stable-list': leastStableList || 'No stability data available.',
    'glicko:most-stable-list-all': mostStableListAll || 'No stability data available.',
    'glicko:least-stable-list-all': leastStableListAll || 'No stability data available.',
    'glicko:leaderboard-table': leaderboardTable || 'No leaderboard data available.',
    'glicko:leaderboard-table-all': leaderboardTableAll || 'No leaderboard data available.',
  };
}

export function resolveTemplate(template: string, placeholders: Record<string, string>): string {
  // Strip ```glicko-placeholders code blocks (reference docs, not report content)
  const stripped = template.replace(/```glicko-placeholders[\s\S]*?```\n?/g, '');
  return stripped.replace(
    /\{\{(glicko:[a-z-]+)(?::(\d+))?\}\}/g,
    (match, key: string, limitStr?: string) => {
      if (!(key in placeholders)) return match;
      const value = placeholders[key];
      if (!limitStr) return value;

      const limit = parseInt(limitStr, 10);
      if (limit <= 0) return value;

      const lines = value.split('\n');

      // For tables, preserve header (first 2 lines) and limit data rows
      if (lines.length > 2 && lines[0].startsWith('|') && lines[1].startsWith('|')) {
        const header = lines.slice(0, 2);
        const dataRows = lines.slice(2);
        return [...header, ...dataRows.slice(0, limit)].join('\n');
      }

      // For bullet lists, limit lines directly
      return lines.slice(0, limit).join('\n');
    },
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function idToName(id: string, idToPath: Map<string, string>): string {
  const path = idToPath.get(id);
  if (!path) return id;
  const parts = path.split('/');
  const filename = parts[parts.length - 1];
  const base = filename.replace(/\.md$/, '');
  return `[[${base}]]`;
}
