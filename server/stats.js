// Match history + rivalry stats. Always persisted to a local JSON file; mirrored to
// Tiger Data (Postgres/Timescale) when DATABASE_URL is set.
import fs from 'node:fs';
import path from 'node:path';

export function createStats({ dataDir }) {
  const file = path.join(dataDir, 'stats.json');
  let db = { matches: [], swings: [] };
  try {
    db = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => fs.writeFile(file, JSON.stringify(db), () => {}), 300);
  };

  let pg = null;
  if (process.env.DATABASE_URL) {
    import('pg')
      .then(async ({ default: pgmod }) => {
        const pool = new pgmod.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await pool.query(`
          CREATE TABLE IF NOT EXISTS matches (
            id TEXT PRIMARY KEY, room TEXT, game TEXT, played_at TIMESTAMPTZ NOT NULL DEFAULT now(), results JSONB, records JSONB);
          CREATE TABLE IF NOT EXISTS motion_events (
            time TIMESTAMPTZ NOT NULL DEFAULT now(), room TEXT, game TEXT, player TEXT, kind TEXT, power REAL, spin REAL, peak REAL);
        `);
        try {
          await pool.query(`SELECT create_hypertable('motion_events', 'time', if_not_exists => TRUE);`);
        } catch (e) {
          console.log('[stats] timescale hypertable unavailable (plain postgres?)', e.message);
        }
        pg = pool;
        console.log('[stats] connected to Tiger Data / Postgres');
      })
      .catch((e) => console.warn('[stats] postgres disabled:', e.message));
  }

  return {
    addMatch(m) {
      const match = { id: m.id || `m${Date.now()}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), ...m };
      db.matches.push(match);
      if (db.matches.length > 500) db.matches.shift();
      save();
      pg?.query('INSERT INTO matches (id, room, game, results, records) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [
        match.id, match.room, match.game, JSON.stringify(match.results), JSON.stringify(match.records || {}),
      ]).catch((e) => console.warn('[stats] insert match', e.message));
      return match;
    },
    addMotion(events) {
      for (const e of events) db.swings.push({ at: Date.now(), ...e });
      if (db.swings.length > 2000) db.swings.splice(0, db.swings.length - 2000);
      save();
      if (pg) {
        for (const e of events) {
          pg.query('INSERT INTO motion_events (room, game, player, kind, power, spin, peak) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
            e.room, e.game, e.player, e.kind, e.power ?? null, e.spin ?? null, e.peak ?? null,
          ]).catch(() => {});
        }
      }
    },
    matches(room) {
      return room ? db.matches.filter((m) => m.room === room) : db.matches;
    },
    records() {
      // all-time bests across every room
      const best = {};
      for (const m of db.matches) {
        for (const [key, rec] of Object.entries(m.records || {})) {
          if (!rec) continue;
          const better = !best[key] || (rec.lowerIsBetter ? rec.value < best[key].value : rec.value > best[key].value);
          if (better) best[key] = rec;
        }
      }
      return best;
    },
    get pgEnabled() {
      return !!pg;
    },
  };
}
