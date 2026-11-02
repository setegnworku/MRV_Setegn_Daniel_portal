/*
 * Per-cell results for the Omo-Gibe SOC Explorer.
 *
 * resultsFor(props, lat, lon) returns real results when window.OMO_GIBE_RESULTS
 * (optional data/results.js, keyed by "lat_lon" with 3 decimals) has the cell,
 * otherwise a deterministic SIMULATION seeded by the cell location:
 *   weather   - monthly climatology (Kiremt/Belg blend by latitude), 2015-2024 rainfall
 *   rothc     - same simplified RothC step as python/C++/Java core, 4 scenarios, 2025-2044
 *   livestock - GLEAM-X-style Tier 1/2 herd emissions (IPCC 2019 Africa, AR6 GWP100)
 *   mrv       - VM0042-style removals with uncertainty deduction and buffer
 */
(function (root) {
  "use strict";

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const NORTH_SHAPE = [1.5, 2.5, 5.5, 7.5, 9, 13, 16, 16, 13, 7.5, 4, 2.5];
  const SOUTH_SHAPE = [3, 4, 14, 20, 12, 4, 2, 2, 4, 13, 15, 7];
  const TEMP_ANOMALY = [0.8, 1.3, 1.6, 1.2, 0.6, -0.4, -1.4, -1.5, -0.8, -0.2, 0.0, 0.4];
  const GWP = { CH4: 27, N2O: 273 };
  const CELL_HA = 0.05 * 111.32 * 0.05 * 111.32 * 100;
  const START_YEAR = 2025;
  const YEARS = 20;
  const BUFFER = 0.15;
  const LEAKAGE = 0.05;

  const SCENARIOS = [
    { id: "BAU", label: "Business as usual", plant: 0.94, manure: 1.0, enteric: 1.0, color: "#757575" },
    { id: "SSM_Low", label: "Low: crop-residue retention", plant: 1.08, manure: 1.2, enteric: 0.98, color: "#f9a825" },
    { id: "SSM_Med", label: "Medium: + manure & rotational grazing", plant: 1.2, manure: 1.6, enteric: 0.93, color: "#ef6c00" },
    { id: "SSM_High", label: "High: + agroforestry & improved feed", plant: 1.35, manure: 2.0, enteric: 0.85, color: "#2e7d32" },
  ];

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function cellKey(lat, lon) {
    return `${lat.toFixed(3)}_${lon.toFixed(3)}`;
  }

  function agroEcologicalZone(elev) {
    if (elev < 1500) return "Kolla (lowland, < 1500 m)";
    if (elev < 2300) return "Weyna Dega (midland, 1500–2300 m)";
    if (elev < 3200) return "Dega (highland, 2300–3200 m)";
    return "Wurch (cold highland, > 3200 m)";
  }

  function farmingSystem(elev, rain) {
    if (elev < 900 || rain < 650) return { name: "Agro-pastoral rangeland", crops: ["sorghum", "maize"], tlu: 25 };
    if (elev < 1800) return { name: "Mixed crop–livestock", crops: ["maize", "sorghum", "coffee"], tlu: 60 };
    if (elev < 2600) return { name: "Cereal–enset–livestock", crops: ["teff", "maize", "enset"], tlu: 75 };
    return { name: "Highland barley–wheat–livestock", crops: ["barley", "wheat", "enset"], tlu: 55 };
  }

  function simulateWeather(p, lat, rnd) {
    const w = clamp((lat - 5.5) / 3, 0, 1);
    const shape = NORTH_SHAPE.map((n, i) => w * n + (1 - w) * SOUTH_SHAPE[i]);
    const total = sum(shape);
    const tAnnual = 30.5 - 0.0062 * p.elev;
    const months = MONTHS.map((m, i) => {
      const tmean = tAnnual + TEMP_ANOMALY[i];
      return {
        month: m,
        rain_mm: round((p.rain * shape[i]) / total, 1),
        tmean_c: round(tmean, 1),
        tmax_c: round(tmean + 6.5, 1),
        tmin_c: round(tmean - 6.5, 1),
        pet_mm: round(40 + 3.2 * tmean, 1),
      };
    });
    const years = [];
    for (let y = 2015; y <= 2024; y++) {
      const drought = y === 2015 ? -0.22 : y === 2022 ? -0.12 : 0;
      const f = 1 + (rnd() - 0.5) * 0.3 + drought;
      years.push({ year: y, rain_mm: Math.round(p.rain * f), anomaly_pct: round((f - 1) * 100, 1) });
    }
    return {
      months,
      years,
      annual_rain_mm: Math.round(sum(months.map((m) => m.rain_mm))),
      annual_pet_mm: Math.round(sum(months.map((m) => m.pet_mm))),
      tmean_c: round(tAnnual, 1),
      wet_months: months.filter((m) => m.rain_mm > 50).length,
    };
  }

  function rothcRate(m, clay) {
    const moist = clamp(m.rain_mm / Math.max(m.pet_mm, 1), 0.2, 1.0);
    const temp = clamp(0.4 + 0.03 * m.tmean_c, 0.3, 1.5);
    const cover = m.rain_mm > 50 ? 0.6 : 1.0;
    return 0.02 * (1 - 0.003 * clay) * moist * temp * cover;
  }

  function simulateLivestock(fs, rnd) {
    const tluKm2 = fs.tlu * (0.8 + 0.4 * rnd());
    const tluHa = tluKm2 / 100;
    const entericCh4 = 40 * tluHa;
    const manureCh4 = 1.5 * tluHa;
    const manureN2o = 40 * 0.02 * (44 / 28) * tluHa;
    const emissions = {
      enteric_ch4_tco2e_ha: (entericCh4 * GWP.CH4) / 1000,
      manure_ch4_tco2e_ha: (manureCh4 * GWP.CH4) / 1000,
      manure_n2o_tco2e_ha: (manureN2o * GWP.N2O) / 1000,
    };
    return {
      tlu_per_km2: round(tluKm2, 1),
      herd_per_km2: {
        cattle: Math.round(tluKm2 * 1.0),
        sheep_goats: Math.round(tluKm2 * 2.0),
        equines: Math.round(tluKm2 * 0.2),
      },
      manure_c_t_ha_yr: round(tluHa * 1.2 * 0.4 * 0.3, 3),
      emissions_tco2e_ha_yr: Object.fromEntries(Object.entries(emissions).map(([k, v]) => [k, round(v, 3)])),
      total_tco2e_ha_yr: round(sum(Object.values(emissions)), 3),
    };
  }

  function simulateRothC(soc0, clay, weather, livestock) {
    const rates = weather.months.map((m) => rothcRate(m, clay));
    const eqInput = soc0 * sum(rates);
    const manureBase = livestock.manure_c_t_ha_yr;
    const plantBase = Math.max(eqInput - manureBase, 0.2);
    const rainShare = weather.months.map((m) => m.rain_mm / Math.max(weather.annual_rain_mm, 1));

    return SCENARIOS.map((s) => {
      let soc = soc0;
      const series = [{ year: START_YEAR - 1, soc_t_ha: round(soc0, 2) }];
      for (let y = 0; y < YEARS; y++) {
        for (let i = 0; i < 12; i++) {
          const input = plantBase * s.plant * rainShare[i] + (manureBase * s.manure) / 12;
          soc = Math.max(0, soc + input - soc * rates[i]);
        }
        series.push({ year: START_YEAR + y, soc_t_ha: round(soc, 2) });
      }
      return { id: s.id, label: s.label, color: s.color, series, final_soc_t_ha: round(soc, 2) };
    });
  }

  function mrvCredits(p, rothc, livestock) {
    const bau = rothc[0];
    const halfWidthPct = (p.pi90 / 2 / Math.max(p.q50, 0.1)) * 100;
    const uncertaintyDeduction = clamp((halfWidthPct - 15) / 100, 0, 0.5);
    return SCENARIOS.slice(1).map((s, idx) => {
      const run = rothc[idx + 1];
      const removals = ((run.final_soc_t_ha - bau.final_soc_t_ha) / YEARS) * (44 / 12);
      const livestockReduction = livestock.emissions_tco2e_ha_yr.enteric_ch4_tco2e_ha * (1 - s.enteric);
      const gross = removals + livestockReduction;
      const net = gross * (1 - uncertaintyDeduction) * (1 - BUFFER) * (1 - LEAKAGE);
      return {
        id: s.id,
        label: s.label,
        color: s.color,
        soil_removals_tco2e_ha_yr: round(removals, 3),
        livestock_reduction_tco2e_ha_yr: round(livestockReduction, 3),
        gross_tco2e_ha_yr: round(gross, 3),
        uncertainty_deduction_pct: round(uncertaintyDeduction * 100, 1),
        buffer_pct: BUFFER * 100,
        leakage_pct: LEAKAGE * 100,
        net_credits_tco2e_ha_yr: round(net, 3),
        net_credits_cell_tco2e_yr: Math.round(net * CELL_HA),
      };
    });
  }

  function simulateCell(p, lat, lon) {
    const rnd = mulberry32(Math.round((lat + 90) * 1000) * 100003 + Math.round((lon + 180) * 1000));
    const clay = round(20 + 25 * rnd(), 1);
    const fs = farmingSystem(p.elev, p.rain);
    const weather = simulateWeather(p, lat, rnd);
    const livestock = simulateLivestock(fs, rnd);
    const rothc = simulateRothC(p.q50, clay, weather, livestock);
    return {
      source: "simulated",
      key: cellKey(lat, lon),
      location: { lat: round(lat, 3), lon: round(lon, 3), cell_ha: Math.round(CELL_HA) },
      site: {
        elevation_m: p.elev,
        agro_ecological_zone: agroEcologicalZone(p.elev),
        farming_system: fs.name,
        main_crops: fs.crops,
        clay_pct: clay,
        ndvi: p.ndvi,
      },
      soc: { q05: p.q05, q50: p.q50, q95: p.q95, pi90: p.pi90, stock_cell_t: Math.round(p.q50 * CELL_HA) },
      weather,
      livestock,
      rothc,
      mrv: mrvCredits(p, rothc, livestock),
      scenarios: SCENARIOS.map(({ id, label, color }) => ({ id, label, color })),
    };
  }

  function resultsFor(p, lat, lon) {
    const real = root && root.OMO_GIBE_RESULTS && root.OMO_GIBE_RESULTS[cellKey(lat, lon)];
    if (real) return Object.assign({ source: "model" }, real);
    return simulateCell(p, lat, lon);
  }

  const api = { resultsFor, simulateCell, cellKey, SCENARIOS, MONTHS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OmoSim = api;
})(typeof window !== "undefined" ? window : globalThis);
