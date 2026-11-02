/*
 * Cell results drawer: Overview | Weather | Soil carbon (RothC) | Livestock | MRV credits.
 * Renders the object returned by OmoSim.resultsFor(); charts use Chart.js.
 */
(function (root) {
  "use strict";

  const TABS = [
    ["overview", "Overview"],
    ["weather", "Weather"],
    ["rothc", "Soil carbon"],
    ["livestock", "Livestock"],
    ["mrv", "MRV credits"],
  ];
  let charts = [];
  let current = null;
  let activeTab = "overview";

  const el = (id) => document.getElementById(id);
  const fmt = (v, d = 2) => Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

  function table(rows) {
    return `<table class="kv">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>`;
  }

  function chartBox(id, height = 220) {
    return `<div class="chart" style="height:${height}px"><canvas id="${id}"></canvas></div>`;
  }

  function addChart(id, config) {
    const ctx = el(id);
    if (!ctx || !root.Chart) return;
    config.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, config.options || {});
    charts.push(new root.Chart(ctx, config));
  }

  function destroyCharts() {
    charts.forEach((c) => c.destroy());
    charts = [];
  }

  function renderOverview(r) {
    const med = r.mrv.find((m) => m.id === "SSM_Med");
    const bau = r.rothc[0];
    const medRun = r.rothc.find((x) => x.id === "SSM_Med");
    el("panelBody").innerHTML = `
      <div class="highlights">
        <div><span>${fmt(r.soc.q50, 1)}</span>t C/ha SOC now<br><small>${fmt(r.soc.q05, 1)}–${fmt(r.soc.q95, 1)} (90%)</small></div>
        <div><span>${fmt(medRun.final_soc_t_ha - bau.final_soc_t_ha, 1)}</span>t C/ha extra by ${bau.series.at(-1).year}<br><small>Medium vs BAU</small></div>
        <div><span>${fmt(med.net_credits_tco2e_ha_yr, 2)}</span>t CO₂e/ha/yr<br><small>net credits (Medium)</small></div>
      </div>
      ${table([
        ["Location", `${r.location.lat}°N, ${r.location.lon}°E (cell ≈ ${r.location.cell_ha.toLocaleString()} ha)`],
        ["Agro-ecological zone", r.site.agro_ecological_zone],
        ["Farming system", r.site.farming_system],
        ["Main crops", r.site.main_crops.join(", ")],
        ["Elevation", `${r.site.elevation_m} m`],
        ["Annual rainfall / PET", `${r.weather.annual_rain_mm} / ${r.weather.annual_pet_mm} mm`],
        ["Mean temperature", `${r.weather.tmean_c} °C`],
        ["Clay", `${r.site.clay_pct} %`],
        ["Livestock density", `${r.livestock.tlu_per_km2} TLU/km²`],
        ["Livestock emissions", `${fmt(r.livestock.total_tco2e_ha_yr, 2)} t CO₂e/ha/yr`],
        ["SOC stock in cell", `${r.soc.stock_cell_t.toLocaleString()} t C`],
      ])}`;
  }

  function renderWeather(r) {
    const w = r.weather;
    el("panelBody").innerHTML = `
      <h4>Monthly climate (climatology)</h4>${chartBox("chWeather", 230)}
      <h4>Annual rainfall 2015–2024</h4>${chartBox("chRainYears", 170)}
      ${table([
        ["Wet months (> 50 mm)", w.wet_months],
        ["Driest year", w.years.reduce((a, b) => (b.rain_mm < a.rain_mm ? b : a)).year],
        ["Used by", "RothC monthly drivers (precip, temperature, PET)"],
        ["Real source (later)", "TerraClimate / CHIRPS via GEE agent, ENACTS"],
      ])}`;
    addChart("chWeather", {
      data: {
        labels: w.months.map((m) => m.month),
        datasets: [
          { type: "bar", label: "Rainfall (mm)", data: w.months.map((m) => m.rain_mm), backgroundColor: "#64b5f6", yAxisID: "y" },
          { type: "line", label: "PET (mm)", data: w.months.map((m) => m.pet_mm), borderColor: "#8d6e63", borderDash: [4, 3], pointRadius: 0, yAxisID: "y" },
          { type: "line", label: "Mean temp (°C)", data: w.months.map((m) => m.tmean_c), borderColor: "#e53935", pointRadius: 2, yAxisID: "y1" },
        ],
      },
      options: {
        scales: {
          y: { title: { display: true, text: "mm / month" }, beginAtZero: true },
          y1: { position: "right", title: { display: true, text: "°C" }, grid: { drawOnChartArea: false } },
        },
        plugins: { legend: { labels: { boxWidth: 12 } } },
      },
    });
    addChart("chRainYears", {
      type: "bar",
      data: {
        labels: w.years.map((y) => y.year),
        datasets: [{ label: "Rainfall (mm)", data: w.years.map((y) => y.rain_mm),
          backgroundColor: w.years.map((y) => (y.anomaly_pct < -10 ? "#e57373" : "#90caf9")) }],
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    });
  }

  function renderRothc(r) {
    const bau = r.rothc[0];
    el("panelBody").innerHTML = `
      <h4>SOC stock 0–20 cm under management scenarios</h4>${chartBox("chRothc", 260)}
      <table class="grid"><tr><th>Scenario</th><th>SOC ${bau.series.at(-1).year}</th><th>Δ vs BAU</th></tr>
        ${r.rothc.map((s) => `<tr><td><i style="background:${s.color}"></i>${s.label}</td><td>${fmt(s.final_soc_t_ha, 1)}</td>
          <td>${s.id === "BAU" ? "–" : "+" + fmt(s.final_soc_t_ha - bau.final_soc_t_ha, 1)}</td></tr>`).join("")}
      </table>
      <p class="note">Start value = QRF median for this cell. Engine: simplified RothC step (same as Python/C++/Java core);
        carbon inputs from crop residues and GLEAM-X manure. Replace with official RothC when vendored.</p>`;
    addChart("chRothc", {
      type: "line",
      data: {
        labels: bau.series.map((p) => p.year),
        datasets: r.rothc.map((s) => ({ label: s.id, data: s.series.map((p) => p.soc_t_ha), borderColor: s.color, pointRadius: 0, borderWidth: 2 })),
      },
      options: { scales: { y: { title: { display: true, text: "t C / ha" } } }, plugins: { legend: { labels: { boxWidth: 12 } } } },
    });
  }

  function renderLivestock(r) {
    const l = r.livestock;
    const e = l.emissions_tco2e_ha_yr;
    el("panelBody").innerHTML = `
      <h4>Emissions by source (t CO₂e/ha/yr)</h4>${chartBox("chLivestock", 220)}
      ${table([
        ["Livestock density", `${l.tlu_per_km2} TLU/km²`],
        ["Cattle", `${l.herd_per_km2.cattle} head/km²`],
        ["Sheep & goats", `${l.herd_per_km2.sheep_goats} head/km²`],
        ["Equines", `${l.herd_per_km2.equines} head/km²`],
        ["Enteric CH₄", `${fmt(e.enteric_ch4_tco2e_ha, 3)} t CO₂e/ha/yr`],
        ["Manure CH₄", `${fmt(e.manure_ch4_tco2e_ha, 3)} t CO₂e/ha/yr`],
        ["Manure N₂O", `${fmt(e.manure_n2o_tco2e_ha, 3)} t CO₂e/ha/yr`],
        ["Total", `<b>${fmt(l.total_tco2e_ha_yr, 3)}</b> t CO₂e/ha/yr`],
        ["Manure C to soil (→ RothC)", `${fmt(l.manure_c_t_ha_yr, 3)} t C/ha/yr`],
      ])}
      <p class="note">GLEAM-X-style Tier 1/2 factors (IPCC 2019, Africa), GWP100 AR6 (CH₄ 27, N₂O 273). Real source later: GLEAM-X R run with CSA/FAO herd data.</p>`;
    addChart("chLivestock", {
      type: "doughnut",
      data: {
        labels: ["Enteric CH₄", "Manure CH₄", "Manure N₂O"],
        datasets: [{ data: [e.enteric_ch4_tco2e_ha, e.manure_ch4_tco2e_ha, e.manure_n2o_tco2e_ha], backgroundColor: ["#8d6e63", "#ffb74d", "#4db6ac"] }],
      },
      options: { plugins: { legend: { position: "right", labels: { boxWidth: 12 } } } },
    });
  }

  function renderMrv(r) {
    const m = r.mrv;
    el("panelBody").innerHTML = `
      <h4>Net creditable removals (t CO₂e/ha/yr)</h4>${chartBox("chMrv", 200)}
      <table class="grid"><tr><th>Step</th>${m.map((s) => `<th>${s.id.replace("SSM_", "")}</th>`).join("")}</tr>
        <tr><td>Soil removals</td>${m.map((s) => `<td>${fmt(s.soil_removals_tco2e_ha_yr, 3)}</td>`).join("")}</tr>
        <tr><td>+ Enteric reduction</td>${m.map((s) => `<td>${fmt(s.livestock_reduction_tco2e_ha_yr, 3)}</td>`).join("")}</tr>
        <tr><td>= Gross</td>${m.map((s) => `<td>${fmt(s.gross_tco2e_ha_yr, 3)}</td>`).join("")}</tr>
        <tr><td>− Uncertainty</td>${m.map((s) => `<td>${s.uncertainty_deduction_pct}%</td>`).join("")}</tr>
        <tr><td>− Buffer / leakage</td>${m.map((s) => `<td>${s.buffer_pct}% / ${s.leakage_pct}%</td>`).join("")}</tr>
        <tr><td><b>Net per ha</b></td>${m.map((s) => `<td><b>${fmt(s.net_credits_tco2e_ha_yr, 3)}</b></td>`).join("")}</tr>
        <tr><td><b>Net per cell / yr</b></td>${m.map((s) => `<td><b>${s.net_credits_cell_tco2e_yr.toLocaleString()}</b></td>`).join("")}</tr>
      </table>
      <p class="note">VM0042-style logic: removals = (scenario − BAU SOC) / 20 yr × 44/12; uncertainty deduction from the QRF 90%
        interval above a 15% half-width; 15% non-permanence buffer; 5% leakage. Indicative only.</p>`;
    addChart("chMrv", {
      type: "bar",
      data: {
        labels: m.map((s) => s.label),
        datasets: [
          { label: "Gross", data: m.map((s) => s.gross_tco2e_ha_yr), backgroundColor: "#c8e6c9" },
          { label: "Net", data: m.map((s) => s.net_credits_tco2e_ha_yr), backgroundColor: m.map((s) => s.color) },
        ],
      },
      options: { indexAxis: "y", plugins: { legend: { labels: { boxWidth: 12 } } }, scales: { x: { beginAtZero: true } } },
    });
  }

  const RENDERERS = { overview: renderOverview, weather: renderWeather, rothc: renderRothc, livestock: renderLivestock, mrv: renderMrv };

  function render() {
    destroyCharts();
    document.querySelectorAll("#panelTabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === activeTab));
    RENDERERS[activeTab](current);
  }

  function open(results) {
    current = results;
    el("panelTitle").textContent = `${results.location.lat}°N, ${results.location.lon}°E`;
    el("panelSubtitle").textContent = `${results.site.farming_system} · ${results.site.agro_ecological_zone.split(" (")[0]}`;
    const badge = el("panelBadge");
    badge.textContent = results.source === "model" ? "MODEL RESULTS" : "SIMULATED DATA";
    badge.className = results.source === "model" ? "badge real" : "badge sim";
    el("panel").classList.add("open");
    render();
  }

  function close() {
    destroyCharts();
    el("panel").classList.remove("open");
    if (root.OmoPanel.onClose) root.OmoPanel.onClose();
  }

  function download() {
    if (!current) return;
    const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `omo_gibe_cell_${current.key}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function init() {
    el("panelTabs").innerHTML = TABS.map(([id, label]) => `<button data-tab="${id}">${label}</button>`).join("");
    el("panelTabs").addEventListener("click", (e) => {
      const tab = e.target.dataset && e.target.dataset.tab;
      if (tab && current) {
        activeTab = tab;
        render();
      }
    });
    el("panelClose").addEventListener("click", close);
    el("panelDownload").addEventListener("click", download);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }

  root.OmoPanel = { init, open, close, onClose: null };
})(window);
