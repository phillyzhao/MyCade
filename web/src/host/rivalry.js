// Session leaderboard, head-to-head records and best-of records derived from match results.
export const PLACE_POINTS = [10, 6, 4, 2, 1, 1, 1, 1];

/** matches: [{game, standings:[{pid,name,color,rank,score,label}], records}] */
export function leaderboard(matches, players) {
  const rows = new Map();
  for (const p of players) rows.set(p.name, { name: p.name, color: p.color, pid: p.id, points: 0, wins: 0, played: 0 });
  for (const m of matches) {
    for (const s of m.standings) {
      const r = rows.get(s.name) || { name: s.name, color: s.color, pid: s.pid, points: 0, wins: 0, played: 0 };
      r.points += PLACE_POINTS[s.rank - 1] || 0;
      r.wins += s.rank === 1 ? 1 : 0;
      r.played += 1;
      rows.set(s.name, r);
    }
  }
  return [...rows.values()].sort((a, b) => b.points - a.points || b.wins - a.wins);
}

export function headToHead(matches) {
  const h = {};
  for (const m of matches) {
    const st = m.standings;
    for (let i = 0; i < st.length; i++)
      for (let j = 0; j < st.length; j++) {
        if (i === j || st[i].rank >= st[j].rank) continue;
        const key = `${st[i].name}\u0000${st[j].name}`;
        h[key] = (h[key] || 0) + 1;
      }
  }
  // collapse into pairs
  const pairs = new Map();
  for (const [key, n] of Object.entries(h)) {
    const [a, b] = key.split('\u0000');
    const id = [a, b].sort().join('\u0000');
    const p = pairs.get(id) || { a: [a, b].sort()[0], b: [a, b].sort()[1], wa: 0, wb: 0 };
    if (a === p.a) p.wa += n;
    else p.wb += n;
    pairs.set(id, p);
  }
  return [...pairs.values()]
    .map((p) => (p.wb > p.wa ? { leader: p.b, trailer: p.a, lw: p.wb, tw: p.wa } : { leader: p.a, trailer: p.b, lw: p.wa, tw: p.wb }))
    .sort((x, y) => y.lw + y.tw - (x.lw + x.tw));
}

export function rivalryLine(r) {
  if (r.lw === r.tw) return `${r.leader} and ${r.trailer} are tied ${r.lw}-${r.tw}`;
  return `${r.leader} leads ${r.trailer} ${r.lw}-${r.tw}`;
}

export function bestRecords(matches) {
  const best = {};
  for (const m of matches)
    for (const [k, rec] of Object.entries(m.records || {})) {
      if (!rec) continue;
      const b = best[k];
      if (!b || (rec.lowerIsBetter ? rec.value < b.value : rec.value > b.value)) best[k] = rec;
    }
  return best;
}

/** Rank helper: items [{pid, score}] -> adds rank (ties share rank). higherIsBetter default true. */
export function rankBy(items, higherIsBetter = true) {
  const sorted = [...items].sort((a, b) => (higherIsBetter ? b.score - a.score : a.score - b.score));
  let rank = 0;
  let prev = null;
  sorted.forEach((it, i) => {
    if (prev === null || it.score !== prev) rank = i + 1;
    prev = it.score;
    it.rank = rank;
  });
  return sorted;
}
