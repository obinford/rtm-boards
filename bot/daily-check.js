// Daily lineup check for Oakley's two NBA leagues (2026-10-18). READ-ONLY: it uses public league data, needs no login,
// and never changes a lineup. Prints a short report: what to swap before today's first tip.
// Usage: node daily-check.js [YYYY-MM-DD]   (date in US Eastern; default today)
const BASE = "https://obinford.github.io/rtm-boards/bot/";
const SLEEPER_LEAGUE = "1416546623709863936", SLEEPER_USER = "992169997764001792";
const ESPN_LEAGUE = 2095435610, ESPN_SEASON = 2027, ESPN_TEAM = 8;
const get = async (u) => { const r = await fetch(u, { headers: { "user-agent": "lineup-check" } }); if (!r.ok) throw new Error(r.status + " " + u.split("?")[0]); return r.json(); };
const etDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d || new Date());
const tm = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
const CAN = { PG: ["PG"], SG: ["SG"], G: ["PG", "SG"], SF: ["SF"], PF: ["PF"], F: ["SF", "PF"], C: ["C"], UTIL: null };
const fits = (s, e) => !CAN[s] || (e || []).some((p) => CAN[s].includes(p));
const OUT_S = { Out: 1, IR: 1, Sus: 1, Suspended: 1, NA: 1 }, RISK_S = { Doubtful: 1, Questionable: 1, DTD: 1, GTD: 1 };

(async () => {
  const day = process.argv[2] || etDate(), out = [];
  const vals = await get(BASE + "values.json");
  const sb = await get("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=" + day.replace(/-/g, ""));
  const ev = sb.events || [];
  if (!ev.length) { console.log(`NOTHING TO DO — no NBA games on ${day}.`); return; }
  const first = ev.map((e) => e.date).sort()[0];
  const minsToTip = Math.round((new Date(first) - Date.now()) / 60000);
  out.push(`**${day}: ${ev.length} NBA games · first tip ${tm(first)}${minsToTip > 0 ? ` (in ${Math.floor(minsToTip / 60)}h ${minsToTip % 60}m)` : " (already started)"}**`);

  // ---------- Kings League (Sleeper, Lock-In) ----------
  try {
    const sched = await get("https://api.sleeper.com/schedule/nba/regular/2026");
    const playing = new Set(); sched.filter((g) => g.date === day && g.status !== "canceled" && g.status !== "postponed").forEach((g) => { playing.add(g.home.team); playing.add(g.away.team); });
    const ros = await get(`https://api.sleeper.app/v1/league/${SLEEPER_LEAGUE}/rosters`), lg = await get(`https://api.sleeper.app/v1/league/${SLEEPER_LEAGUE}`);
    const me = ros.find((r) => r.owner_id === SLEEPER_USER);
    const all = await get("https://api.sleeper.app/v1/players/nba");
    const slots = lg.roster_positions.filter((p) => p !== "BN" && p !== "IR");
    const info = (id) => { const p = all[id] || {}, v = vals.sleeper[id] || {}; return { id, n: v.n || `${p.first_name} ${p.last_name}`, e: v.e || p.fantasy_positions || [], mu: v.mu || 0, team: p.team, inj: p.injury_status || "", plays: playing.has(p.team) }; };
    const starters = (me.starters || []).map(info), bench = (me.players || []).filter((id) => !(me.starters || []).includes(id) && !(me.reserve || []).includes(id)).map(info);
    const issues = [], used = new Set();
    starters.forEach((s, j) => {
      const slot = slots[j]; if (!s || !s.id || s.id === "0") { issues.push(`${slot}: empty slot`); return; }
      // Lock-In: a starter with no game today can still score later this week, so only injuries are flagged here;
      // lock/swap calls come from Lock or Hold (it knows each player's remaining games and your bench).
      if (RISK_S[s.inj]) { issues.push(`${slot} ${s.n} is ${s.inj} — check news before tip`); return; }
      if (!OUT_S[s.inj]) return;
      const sub = bench.filter((b) => !OUT_S[b.inj] && !used.has(b.id) && fits(slot, b.e)).sort((a, b) => (b.plays - a.plays) || (b.mu - a.mu))[0];
      if (sub) { used.add(sub.id); issues.push(`${slot}: ${s.n} is ruled ${s.inj} → start ${sub.n} (${sub.team}, ${sub.mu} pts/g${sub.plays ? ", plays today" : ""})`); }
      else issues.push(`${slot}: ${s.n} is ruled ${s.inj} and no healthy bench player fits this slot`);
    });
    out.push("", "**Kings League (Sleeper)**", ...(issues.length ? issues.map((x) => "- " + x) : ["- No injured starters."]), "- Lock and swap calls for tonight: https://obinford.github.io/rtm-boards/lock/");
  } catch (e) { out.push("", "**Kings League (Sleeper)**", "- Couldn't check: " + e.message); }

  // ---------- The Real Hoopers League (ESPN, daily lineups) ----------
  try {
    const lg = await get(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${ESPN_SEASON}/segments/0/leagues/${ESPN_LEAGUE}?view=mRoster`);
    const team = (lg.teams || []).find((t) => t.id === ESPN_TEAM), entries = team && team.roster ? team.roster.entries : [];
    if (!entries.length) out.push("", "**Real Hoopers (ESPN)**", "- No roster yet (before the draft).");
    else {
      const playing = {}; ev.forEach((e) => (e.competitions[0].competitors || []).forEach((c) => { playing[c.team.abbreviation] = e.date; }));
      const ps = entries.map((en) => { const p = (en.playerPoolEntry || {}).player || {}, ab = vals.proteams[p.proTeamId] || ""; return { n: p.fullName, slot: en.lineupSlotId, inj: p.injuryStatus || "ACTIVE", el: (p.eligibleSlots || []).filter((s) => s <= 6 || s === 11), tip: playing[ab] || null, mu: (vals.espn[en.playerId] || {}).mu || 0 }; });
      const SN = { 0: "PG", 1: "SG", 2: "SF", 3: "PF", 4: "C", 5: "G", 6: "F", 11: "UTIL" };
      const active = ps.filter((p) => p.slot <= 6 || p.slot === 11), benchE = ps.filter((p) => p.slot === 12);
      const isOut = (p) => p.inj === "OUT" || p.inj === "SUSPENSION" || p.inj === "INJURY_RESERVE";
      const issues = [], used = new Set();
      active.filter((p) => !p.tip || isOut(p)).sort((a, b) => b.mu - a.mu).forEach((p) => {
        const sub = benchE.filter((b) => b.tip && !isOut(b) && !used.has(b.n) && b.el.includes(p.slot)).sort((a, b) => b.mu - a.mu)[0];
        if (sub) { used.add(sub.n); issues.push(`${SN[p.slot]}: ${p.n} (${isOut(p) ? "out" : "no game"}) → start ${sub.n} (tips ${tm(sub.tip)})`); }
      });
      benchE.filter((b) => b.tip && !isOut(b) && !used.has(b.n) && b.mu > 0).forEach((b) => {
        const worst = active.filter((a) => a.tip && !isOut(a) && b.el.includes(a.slot)).sort((x, y) => x.mu - y.mu)[0];
        if (worst && b.mu > worst.mu + 3) issues.push(`${SN[worst.slot]}: consider ${b.n} (${b.mu} pts/g) over ${worst.n} (${worst.mu})`);
      });
      active.filter((p) => p.inj === "DAY_TO_DAY" || p.inj === "QUESTIONABLE" || p.inj === "DOUBTFUL").forEach((p) => issues.push(`${SN[p.slot]} ${p.n} is ${p.inj.toLowerCase().replace(/_/g, " ")} — check news before tip`));
      out.push("", "**Real Hoopers (ESPN)**", ...(issues.length ? issues.map((x) => "- " + x) : ["- Lineup looks fine for today."]), "- Full view: https://obinford.github.io/rtm-boards/espn-lineup/");
    }
  } catch (e) { out.push("", "**Real Hoopers (ESPN)**", "- Couldn't check: " + e.message); }
  console.log(out.join("\n"));
})().catch((e) => { console.log("CHECK FAILED: " + e.message); process.exit(1); });
