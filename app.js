/* global React, ReactDOM */
const { useMemo, useState, useEffect } = React;

// =============================
// Helferfunktionen
// =============================
function parseTasks(text) {
  return text
    .split(/\n|,/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?):\s*(\d+)$/);
      if (!m) return { name: line, count: 1 };
      return { name: m[1].trim(), count: parseInt(m[2], 10) };
    });
}

function parseCSVList(text) {
  return text
    .split(/,|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseIntListCSV(text) {
  return text
    .split(/,|\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isFinite(n));
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Seedbarer RNG (Mulberry32)
function makeRNG(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Plan erzeugen
function generateSchedule({ kids, tasks, weeks, perChildWeeklyTargets, seed = 42, maxTries = 500 }) {
  if (!Array.isArray(kids) || kids.length === 0) throw new Error("Keine Kinder angegeben.");
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error("Keine Tasks angegeben.");
  if (!Number.isFinite(weeks) || weeks <= 0) throw new Error("Ungültige Wochenzahl.");
  if (!Array.isArray(perChildWeeklyTargets) || perChildWeeklyTargets.length !== weeks) {
    throw new Error(`Wochenziele müssen genau ${weeks} Werte haben.`);
  }

  const rng = makeRNG(seed);

  const instances = [];
  tasks.forEach((t) => {
    for (let i = 0; i < t.count; i++) instances.push({ name: t.name, id: `${t.name}#${i + 1}` });
  });

  const perWeekCap = perChildWeeklyTargets.map((n) => n * kids.length);
  const totalCap = perWeekCap.reduce((a, b) => a + b, 0);
  if (instances.length > totalCap) {
    throw new Error(`Zu viele Task-Vorkommen (${instances.length}) für die gewählten Wochenziele (Kapazität ${totalCap}).`);
  }

  const schedule = Array.from({ length: weeks }, () => {
    const m = new Map();
    kids.forEach((k) => m.set(k, []));
    return m;
  });

  const kidTaskUsed = new Map();
  const kidWeekLoad = Array.from({ length: weeks }, () => new Map());
  for (let w = 0; w < weeks; w++) kids.forEach((k) => kidWeekLoad[w].set(k, 0));

  const instShuffled = shuffle(instances, rng);

  function tryBuild() {
    for (let w = 0; w < weeks; w++) {
      schedule[w].forEach((_, k) => schedule[w].set(k, []));
      kids.forEach((k) => kidWeekLoad[w].set(k, 0));
    }
    kidTaskUsed.clear();

    const orderWeeks = [...Array(weeks).keys()];
    let wPtr = 0;

    for (const inst of instShuffled) {
      let placed = false;
      for (let turn = 0; turn < weeks && !placed; turn++) {
        const w = orderWeeks[(wPtr + turn) % weeks];
        const weekCapacity = perWeekCap[w];
        const usedWeek = [...schedule[w].values()].reduce((a, arr) => a + arr.length, 0);
        if (usedWeek >= weekCapacity) continue;

        const kidsByLoad = kids
          .map((k) => ({ k, load: kidWeekLoad[w].get(k) || 0 }))
          .sort((a, b) => a.load - b.load);

        let assignedKid = null;
        for (const { k } of kidsByLoad) {
          const have = (kidTaskUsed.get(`${k}::${inst.name}`) || 0) > 0;
          if (!have && (kidWeekLoad[w].get(k) || 0) < perChildWeeklyTargets[w]) {
            assignedKid = k;
            break;
          }
        }
        if (!assignedKid) {
          for (const { k } of kidsByLoad) {
            if ((kidWeekLoad[w].get(k) || 0) < perChildWeeklyTargets[w]) {
              assignedKid = k;
              break;
            }
          }
        }
        if (!assignedKid) continue;

        schedule[w].get(assignedKid).push(inst.name);
        kidWeekLoad[w].set(assignedKid, (kidWeekLoad[w].get(assignedKid) || 0) + 1);
        kidTaskUsed.set(`${assignedKid}::${inst.name}`, (kidTaskUsed.get(`${assignedKid}::${inst.name}`) || 0) + 1);
        placed = true;
        wPtr = (wPtr + 1) % weeks;
      }
      if (!placed) return false;
    }
    return true;
  }

  for (let t = 0; t < maxTries; t++) {
    if (tryBuild()) return schedule;
  }
  throw new Error("Konnte keinen gültigen Plan erzeugen – passe Tasks oder Wochenziele an.");
}

function exportCSV(schedule, kids) {
  const weeks = schedule.length;
  const rows = ["Woche,Kind,Aufgaben"];
  for (let w = 0; w < weeks; w++) {
    for (const kid of kids) {
      const list = schedule[w].get(kid) || [];
      rows.push(`${w + 1},${kid},"${list.join("; ")}"`);
    }
  }
  return rows.join("\n");
}

// =============================
// React App
// =============================
function App() {
  const [kidsInput, setKidsInput] = useState(() => localStorage.getItem("jugendlohn_kids") || "Mael, Lenas, Elea");
  const [tasksInput, setTasksInput] = useState(
    () =>
      localStorage.getItem("jugendlohn_tasks") ||
      [
        "Abwaschen: 4",
        "Staubsaugen: 4",
        "Tisch decken: 4",
        "Wäsche zusammenlegen: 4",
        "Müll rausbringen: 4",
        "Bad putzen: 3",
        "Zimmer aufräumen: 6",
      ].join("\n")
  );
  const [weeks, setWeeks] = useState(() => {
    const v = parseInt(localStorage.getItem("jugendlohn_weeks") || "4", 10);
    return Number.isFinite(v) && v > 0 ? v : 4;
  });
  const [targetsInput, setTargetsInput] = useState(() => localStorage.getItem("jugendlohn_targets") || "5,5,3,2");
  const [seed, setSeed] = useState(() => {
    const v = parseInt(localStorage.getItem("jugendlohn_seed") || "42", 10);
    return Number.isFinite(v) ? v : 42;
  });

  const [schedule, setSchedule] = useState(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(() => {
    try {
      const raw = localStorage.getItem("jugendlohn_done");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [showConfig, setShowConfig] = useState(() => {
    const raw = localStorage.getItem("jugendlohn_showConfig");
    return raw === null ? true : raw === "true";
  });
  const [currentUser, setCurrentUser] = useState(() => localStorage.getItem("jugendlohn_user") || "");

  useEffect(() => { try { localStorage.setItem("jugendlohn_kids", kidsInput); } catch {} }, [kidsInput]);
  useEffect(() => { try { localStorage.setItem("jugendlohn_tasks", tasksInput); } catch {} }, [tasksInput]);
  useEffect(() => { try { localStorage.setItem("jugendlohn_weeks", String(weeks)); } catch {} }, [weeks]);
  useEffect(() => { try { localStorage.setItem("jugendlohn_targets", targetsInput); } catch {} }, [targetsInput]);
  useEffect(() => { try { localStorage.setItem("jugendlohn_seed", String(seed)); } catch {} }, [seed]);
  useEffect(() => { try { localStorage.setItem("jugendlohn_showConfig", String(showConfig)); } catch {} }, [showConfig]);

  const kids = useMemo(() => parseCSVList(kidsInput), [kidsInput]);
  const tasks = useMemo(() => parseTasks(tasksInput), [tasksInput]);
  const perChildWeeklyTargets = useMemo(() => parseIntListCSV(targetsInput), [targetsInput]);

  const totalTaskCount = useMemo(() => tasks.reduce((a, t) => a + t.count, 0), [tasks]);
  const totalCapacity = useMemo(() => perChildWeeklyTargets.reduce((a, b) => a + b, 0) * kids.length, [perChildWeeklyTargets, kids]);

  useEffect(() => {
    tryGenerate();
    runSelfTests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function tryGenerate(customSeed) {
    setError("");
    try {
      if (perChildWeeklyTargets.length !== weeks) {
        throw new Error(`Wochenziele (aktuell ${perChildWeeklyTargets.length}) müssen genau ${weeks} Werte haben.`);
      }
      const sched = generateSchedule({ kids, tasks, weeks, perChildWeeklyTargets, seed: Number(customSeed ?? seed) });
      setSchedule(sched);
      setShowConfig(false);
      if (!currentUser && kids.length) {
        setCurrentUser(kids[0]);
        try { localStorage.setItem("jugendlohn_user", kids[0]); } catch {}
      }
    } catch (e) {
      setSchedule(null);
      setError(e.message);
    }
  }

  function onGenerate() { tryGenerate(); }

  function onExportCSV() {
    if (!schedule) return;
    const csv = exportCSV(schedule, kids);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jugendlohn-plan.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function keyFor(w, kid, idx) {
    return `${w}|${kid}|${idx}`;
  }

  function toggleDone(w, kid, idx) {
    const k = keyFor(w, kid, idx);
    setDone((prev) => {
      const next = { ...prev, [k]: !prev[k] };
      try { localStorage.setItem("jugendlohn_done", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function resetDone() {
    setDone({});
    try { localStorage.removeItem("jugendlohn_done"); } catch {}
  }

  function weekProgress(w, filteredKids) {
    if (!schedule) return { total: 0, done: 0 };
    const weekMap = schedule[w];
    let total = 0, d = 0;
    for (const kid of filteredKids) {
      const list = weekMap.get(kid) || [];
      list.forEach((_, i) => {
        total++;
        if (done[keyFor(w, kid, i)]) d++;
      });
    }
    return { total, done: d };
  }

  const headerGradient = "bg-gradient-to-r from-violet-500 to-indigo-500 text-white";
  const cardAccent = "border-violet-200";
  const pill = "rounded-2xl shadow bg-white border hover:shadow-md transition";

  const filteredKids = useMemo(() => {
    return currentUser && kids.includes(currentUser) ? [currentUser] : kids;
  }, [currentUser, kids]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className={`w-full ${headerGradient} p-6 shadow`}>
        <div className="max-w-5xl mx-auto flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl font-bold">Jugendlohn – Auto-Task-Verteiler</h1>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              className="px-3 py-2 rounded-xl text-neutral-900"
              value={seed}
              onChange={(e) => setSeed(parseInt(e.target.value || "42", 10))}
            />
            <button
              onClick={() => { const s = Math.floor(Math.random() * 1e9); setSeed(s); tryGenerate(s); }}
              className="px-4 py-2 rounded-xl bg-white/90 text-neutral-900 hover:bg-white"
            >
              Neu mischen
            </button>
            <button onClick={onGenerate} className="px-4 py-2 rounded-xl bg-white/90 text-neutral-900 hover:bg-white">
              Plan neu erzeugen
            </button>

            {schedule && (
              <div className="flex items-center gap-2 ml-2">
                <span className="text-sm opacity-90">Ich bin:</span>
                <select
                  className="px-3 py-2 rounded-xl text-neutral-900"
                  value={currentUser}
                  onChange={(e) => { setCurrentUser(e.target.value); try { localStorage.setItem("jugendlohn_user", e.target.value); } catch {} }}
                >
                  {kids.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
                {currentUser && <span className="text-xs bg-white/20 px-2 py-1 rounded-lg">Nur {currentUser}</span>}
              </div>
            )}

            {!showConfig && (
              <button onClick={() => setShowConfig(true)} className="px-3 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-white">
                Einstellungen anzeigen
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {showConfig && (
          <section className="grid md:grid-cols-3 gap-4">
            <div className="col-span-1 space-y-3">
              <label className="block text-sm font-medium">Kinder (Kommagetrennt)</label>
              <input className="w-full border rounded-2xl p-2 bg-white" value={kidsInput} onChange={(e) => setKidsInput(e.target.value)} />

              <label className="block text-sm font-medium">Wochenziele pro Kind (z. B. 5,5,3,2)</label>
              <input className="w-full border rounded-2xl p-2 bg-white" value={targetsInput} onChange={(e) => setTargetsInput(e.target.value)} />

              <label className="block text-sm font-medium">Anzahl Wochen</label>
              <input type="number" className="w-full border rounded-2xl p-2 bg-white" value={weeks} onChange={(e) => setWeeks(parseInt(e.target.value || "4", 10))} />

              <div className="flex gap-2 pt-1">
                <button onClick={onExportCSV} className={`${pill} text-sm px-3 py-1.5`}>CSV exportieren</button>
                <button onClick={() => setShowConfig(false)} className={`${pill} text-sm px-3 py-1.5`}>Konfig ausblenden</button>
              </div>
              <div className="text-xs text-neutral-600">Abhaken wird lokal gespeichert (dieses Gerät). Einstellungen werden automatisch gesichert.</div>
            </div>

            <div className="col-span-2 space-y-3">
              <label className="block text-sm font-medium">Tasks (eine pro Zeile, optional mit ": Anzahl" pro Monat)</label>
              <textarea className="w-full h-48 border rounded-2xl p-3 bg-white" value={tasksInput} onChange={(e) => setTasksInput(e.target.value)} />
              <div className="text-sm text-neutral-600">
                <p>
                  Gesamt-Task-Vorkommen: <b>{totalTaskCount}</b> • Kapazität (Kinder × Wochenziele): <b>{totalCapacity}</b>
                </p>
              </div>
            </div>
          </section>
        )}

        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-red-800">{error}</div>}

        {schedule && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Monatsplan</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {schedule.map((weekMap, w) => {
                const prog = weekProgress(w, filteredKids);
                const pct = prog.total ? Math.round((100 * prog.done) / prog.total) : 0;
                return (
                  <div key={w} className={`bg-white border ${cardAccent} rounded-2xl p-4 shadow-sm`}>
                    <div className="mb-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium">Woche {w + 1}</h3>
                        <div className="text-xs text-neutral-600">
                          {prog.done}/{prog.total} erledigt ({pct}%)
                        </div>
                      </div>
                      <div className="mt-2 h-2 w-full bg-neutral-100 rounded-full overflow-hidden">
                        <div className="h-2 bg-gradient-to-r from-emerald-400 to-teal-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <ul className="space-y-3">
                      {filteredKids.map((kid) => (
                        <li key={kid} className="border rounded-xl p-3">
                          <div className="text-sm font-semibold mb-2 flex items-center justify-between">
                            <span>{kid}</span>
                            <span className="text-xs text-neutral-500">Ziel: {perChildWeeklyTargets[w]} / Woche</span>
                          </div>
                          <div className="flex flex-col gap-2">
                            {(weekMap.get(kid) || []).map((taskName, i) => {
                              const k = `${w}|${kid}|${i}`;
                              return (
                                <label key={k} className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={!!done[k]}
                                    onChange={() => toggleDone(w, kid, i)}
                                    className="h-4 w-4"
                                  />
                                  <span className={done[k] ? "line-through text-neutral-400" : ""}>{taskName}</span>
                                </label>
                              );
                            })}
                            {(weekMap.get(kid) || []).length === 0 && <em className="text-sm text-neutral-400">– keine –</em>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button onClick={onExportCSV} className={`${pill} px-3 py-1.5 text-sm`}>CSV exportieren</button>
              <button onClick={resetDone} className={`${pill} px-3 py-1.5 text-sm`}>Abhaken zurücksetzen</button>
            </div>
          </section>
        )}

        {!schedule && !error && <div className="text-sm text-neutral-600">Erzeuge einen Plan, um die Wochenansicht zu sehen.</div>}

        <footer className="text-xs text-neutral-500 pt-6">
          <p>
            Tipps: "Neu mischen" vergibt die Aufgaben fair neu (anderer Seed). Abhaken & Einstellungen bleiben beim Schliessen der Seite erhalten. Personenauswahl filtert die Ansicht.
          </p>
        </footer>
      </div>
    </div>
  );
}

// Selbsttests (Konsole)
function runSelfTests() {
  try {
    const pt = parseTasks("A: 2\nB\nC: 3");
    console.assert(pt.length === 3, "parseTasks length");
    console.assert(pt[0].name === "A" && pt[0].count === 2, "parseTasks A");
    console.assert(pt[1].name === "B" && pt[1].count === 1, "parseTasks default count");

    const ints = parseIntListCSV("5,5,3,2");
    console.assert(ints.join("-") === "5-5-3-2", "parseIntListCSV basic");

    const kids = ["X", "Y", "Z"];
    const tasks = parseTasks("T1: 6\nT2: 6");
    const weeks = 2;
    const goals = [2, 2];
    const plan = generateSchedule({ kids, tasks, weeks, perChildWeeklyTargets: goals, seed: 1 });
    console.assert(plan.length === 2, "schedule weeks");
    for (let w = 0; w < weeks; w++) {
      kids.forEach((k) => {
        const load = (plan[w].get(k) || []).length;
        console.assert(load <= goals[w], `week load <= target (${load} <= ${goals[w]})`);
      });
    }

    let threw = false;
    try {
      generateSchedule({ kids, tasks: parseTasks("A: 20"), weeks: 2, perChildWeeklyTargets: goals, seed: 1 });
    } catch (e) { threw = true; }
    console.assert(threw, "should throw on over-capacity");

    console.log("✅ Selbsttests ok");
  } catch (e) {
    console.warn("⚠️ Selbsttests fehlgeschlagen:", e);
  }
}

// App mounten
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);