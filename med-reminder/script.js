document.addEventListener("DOMContentLoaded", () => {
  // --- elements
  const timingRadios = document.querySelectorAll('input[name="timing"]');
  const oneDayForm   = document.getElementById("oneDayForm");
  const oneWeekForm  = document.getElementById("oneWeekForm");
  const dailyCount   = document.getElementById("dailyCount");
  const dailyTimes   = document.getElementById("dailyTimes");
  const weeklyCount  = document.getElementById("weeklyCount");
  const weeklyTimes  = document.getElementById("weeklyTimes");

  const DAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];

  // --- show/hide sections
  timingRadios.forEach((r) => {
    r.addEventListener("change", function () {
      if (this.value === "yes") {
        oneDayForm.style.display = "block";
        oneWeekForm.style.display = "none";
      } else {
        oneDayForm.style.display = "none";
        oneWeekForm.style.display = "block";
      }
      document.getElementById("saveStatusDaily").textContent = "";
      document.getElementById("saveStatusWeekly").textContent = "";

    });
  });

  // --- spawn inputs for daily
  dailyCount?.addEventListener("input", function () {
    const count = clampInt(this.value, 0, 10);
    dailyTimes.innerHTML = "";
    for (let i = 1; i <= count; i++) {
      dailyTimes.insertAdjacentHTML(
        "beforeend",
        `<label>Time ${i}: <input type="time" name="daily_${i}" required></label><br>`
      );
    }
  });

  // --- spawn inputs for weekly
  weeklyCount?.addEventListener("input", function () {
    const count = clampInt(this.value, 0, 10);
    weeklyTimes.innerHTML = "";
    DAYS.forEach(day => {
      let inputs = "";
      for (let i = 1; i <= count; i++) {
        inputs += `<label>${day} - Time ${i}: <input type="time" name="${day.toLowerCase()}_${i}" required></label><br>`;
      }
      weeklyTimes.insertAdjacentHTML(
        "beforeend",
        `<div style="margin-bottom:0.75em;">
          <strong>${day}</strong><br>${inputs}
        </div>`
      );
    });
  });

  // DAILY save
  document.getElementById("savePlanDaily").addEventListener("click", () => {
    try {
      const plan = collectPlan();    // uses dailyCount/dailyTimes
      validatePlan(plan);
      localStorage.setItem("medSchedule", JSON.stringify(plan));
      document.getElementById("saveStatusDaily").style.color = "#22c55e";
      document.getElementById("saveStatusDaily").textContent = "Saved ✅";
    } catch (err) {
      document.getElementById("saveStatusDaily").style.color = "#ef4444";
      document.getElementById("saveStatusDaily").textContent = err.message;
    }
  });

  // WEEKLY save
  document.getElementById("savePlanWeekly").addEventListener("click", () => {
    try {
      const plan = collectPlan();    // uses weeklyCount/weeklyTimes
      validatePlan(plan);
      localStorage.setItem("medSchedule", JSON.stringify(plan));
      document.getElementById("saveStatusWeekly").style.color = "#22c55e";
      document.getElementById("saveStatusWeekly").textContent = "Saved ✅";
    } catch (err) {
      document.getElementById("saveStatusWeekly").style.color = "#ef4444";
      document.getElementById("saveStatusWeekly").textContent = err.message;
    }
  });

  // --- helpers
  function clampInt(val, min, max) {
    const n = parseInt(val, 10);
    if (isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function getSelectedTiming() {
    const r = Array.from(timingRadios).find(r => r.checked);
    return r ? r.value : null; // "yes" | "no" | null
  }

  function collectPlan() {
    const mode = getSelectedTiming(); // yes (same daily) | no (weekly)
    if (!mode) throw new Error("Pick whether your timing is the same every day.");

    if (mode === "yes") {
      const count = clampInt(dailyCount.value, 1, 10);
      const times = getTimeInputs(dailyTimes);
      if (times.length !== count) {
        throw new Error("Fill all daily time fields.");
      }
      // Normalize: daily plan -> weekly expanded to same times
      const schedule = {};
      DAYS.forEach(d => { schedule[d] = [...times]; });

      return {
        version: 1,
        mode: "daily",
        count,
        times,           // ["08:00","20:00",...]
        scheduleByDay: schedule, // expanded for convenience
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        savedAt: new Date().toISOString()
      };
    } else {
      const count = clampInt(weeklyCount.value, 1, 10);
      const schedule = {};
      for (const day of DAYS) {
        const inputs = weeklyTimes.querySelectorAll(`input[name^="${day.toLowerCase()}_"]`);
        const values = Array.from(inputs).map(i => i.value).filter(Boolean);
        if (values.length !== count) {
          throw new Error(`Fill all time fields for ${day}.`);
        }
        schedule[day] = values;
      }
      return {
        version: 1,
        mode: "weekly",
        count,
        scheduleByDay: schedule, // { Monday: ["08:00","20:00"], ... }
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        savedAt: new Date().toISOString()
      };
    }
  }

  function getTimeInputs(containerEl) {
    return Array.from(containerEl.querySelectorAll('input[type="time"]'))
      .map(i => i.value)
      .filter(Boolean);
  }

  function validatePlan(plan) {
    // basic sanity: ensure HH:MM 24h format
    const isTime = (t) => /^\d{2}:\d{2}$/.test(t);
    if (plan.mode === "daily") {
      if (!plan.times.length) throw new Error("Add at least one daily time.");
      for (const t of plan.times) if (!isTime(t)) throw new Error(`Invalid time: ${t}`);
    } else {
      for (const day of DAYS) {
        const arr = plan.scheduleByDay[day] || [];
        if (!arr.length) throw new Error(`Missing times for ${day}.`);
        for (const t of arr) if (!isTime(t)) throw new Error(`Invalid time for ${day}: ${t}`);
      }
    }
    // optional: ensure ascending order
    sortTimesInPlace(plan);
  }

  function sortTimesInPlace(plan) {
    const sortFn = (a,b) => a.localeCompare(b); // "08:00" sorts fine lexicographically
    if (plan.mode === "daily") {
      plan.times.sort(sortFn);
      DAYS.forEach(d => plan.scheduleByDay[d].sort(sortFn));
    } else {
      DAYS.forEach(d => plan.scheduleByDay[d].sort(sortFn));
    }
  }

  async function postPlan(plan) {
    const res = await fetch("/api/med-schedule", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(plan),
      credentials: "include"
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Server save failed: ${res.status} ${text}`);
    }
    return res.json().catch(() => ({}));
  }

  // --- (Nice to have) load previously saved plan and re-fill UI
  const existing = localStorage.getItem("medSchedule");
  if (existing) {
    try {
      const plan = JSON.parse(existing);
      // pre-check radio
      const val = plan.mode === "daily" ? "yes" : "no";
      const radio = Array.from(timingRadios).find(r => r.value === val);
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event("change"));
      }
      // spawn inputs + refill
      if (plan.mode === "daily") {
        dailyCount.value = plan.count;
        dailyCount.dispatchEvent(new Event("input"));
        const fields = dailyTimes.querySelectorAll('input[type="time"]');
        plan.times.forEach((t, idx) => { if (fields[idx]) fields[idx].value = t; });
      } else {
        weeklyCount.value = plan.count;
        weeklyCount.dispatchEvent(new Event("input"));
        DAYS.forEach(day => {
          const vals = plan.scheduleByDay?.[day] || [];
          vals.forEach((t, i) => {
            const el = weeklyTimes.querySelector(`input[name="${day.toLowerCase()}_${i+1}"]`);
            if (el) el.value = t;
          });
        });
      }
      if (plan.mode === "daily") {
        document.getElementById("saveStatusDaily").style.color = "#9ca3af";
        document.getElementById("saveStatusDaily").textContent = "Loaded saved schedule.";
      } else {
        document.getElementById("saveStatusWeekly").style.color = "#9ca3af";
        document.getElementById("saveStatusWeekly").textContent = "Loaded saved schedule.";
      }

    } catch {}
  }
  const checklistEl = document.getElementById("medChecklist");

  // build checklist UI
  function buildChecklist() {
    checklistEl.innerHTML = "";
    DAYS.forEach((day, idx) => {
      checklistEl.insertAdjacentHTML("beforeend", `
        <label>
          <input type="checkbox" data-day="${idx}">
          ${day.slice(0,3)}
        </label>
      `);
    });
  }

  // load/save checklist
  function loadChecklist() {
    const data = JSON.parse(localStorage.getItem("medChecklist")) || {};
    document.querySelectorAll("#medChecklist input").forEach(cb => {
      cb.checked = !!data[cb.dataset.day];
    });
  }

  function saveChecklist() {
    const data = {};
    document.querySelectorAll("#medChecklist input").forEach(cb => {
      data[cb.dataset.day] = cb.checked;
    });
    localStorage.setItem("medChecklist", JSON.stringify(data));
  }

  // reset weekly at Sunday midnight
  function resetChecklistIfNeeded() {
    const now = new Date();
    const lastReset = localStorage.getItem("medChecklistLastReset");
    const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

    if (lastReset !== todayKey && now.getDay() === 0 && now.getHours() === 0) {
      localStorage.removeItem("medChecklist");
      localStorage.setItem("medChecklistLastReset", todayKey);
      buildChecklist();
      loadChecklist();
    }
  }

  // hook up events
  buildChecklist();
  loadChecklist();
  checklistEl.addEventListener("change", saveChecklist);

  // check reset every hour
  setInterval(resetChecklistIfNeeded, 60 * 1000);

});

// run every 30s
setInterval(checkMeds, 30 * 1000);

function checkMeds() {
  const planStr = localStorage.getItem("medSchedule");
  if (!planStr) return;

  const plan = JSON.parse(planStr);
  const now = new Date();
  
  // current time "HH:MM" 24h
  const hh = String(now.getHours()).padStart(2,"0");
  const mm = String(now.getMinutes()).padStart(2,"0");
  const current = `${hh}:${mm}`;

  let todaysTimes = [];
  if (plan.mode === "daily") {
    todaysTimes = plan.times;
  } else {
    const dayName = now.toLocaleDateString("en-US",{weekday:"long"});
    todaysTimes = plan.scheduleByDay?.[dayName] || [];
  }

  if (todaysTimes.includes(current)) {
    const sound = document.getElementById("medSound");
    sound.play().catch(e => {
      console.warn("Autoplay blocked until user interacts", e);
    });
    showBigPopup();
  }
}
function showBigPopup() {
  document.getElementById("bigPopup").classList.remove("hidden");
}

document.getElementById("closePopup").addEventListener("click", () => {
  document.getElementById("bigPopup").classList.add("hidden");
});
