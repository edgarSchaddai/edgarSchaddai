// Genera assets/stats-light.svg y assets/stats-dark.svg con datos reales de la API de GitHub.
// Requiere GH_STATS_TOKEN con permiso de lectura sobre los repositorios del usuario.
import { writeFileSync, mkdirSync } from "node:fs";

const LOGIN = "edgarSchaddai";
const PROFILE_REPO = "edgarSchaddai";
const TOKEN = process.env.GH_STATS_TOKEN;
if (!TOKEN) {
  console.error("Falta la variable de entorno GH_STATS_TOKEN");
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": `${LOGIN}-profile-stats`,
};

async function rest(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// --- Datos de actividad -----------------------------------------------------
const data = await graphql(
  `query ($login: String!) {
    user(login: $login) {
      contributionsCollection {
        totalCommitContributions
        contributionCalendar { totalContributions }
      }
      repositories(first: 100, ownerAffiliations: OWNER) { totalCount }
    }
  }`,
  { login: LOGIN }
);
const contributions = data.user.contributionsCollection.contributionCalendar.totalContributions;
const commits = data.user.contributionsCollection.totalCommitContributions;
const repoCount = data.user.repositories.totalCount;

// --- Lenguajes ponderados por repositorio -----------------------------------
// Cada repo pesa igual (evita que librerías vendorizadas de un solo repo dominen).
const repos = await rest(`/user/repos?affiliation=owner&per_page=100`);
const shares = new Map();
let reposWithCode = 0;
for (const repo of repos) {
  if (repo.name === PROFILE_REPO || repo.fork) continue;
  const langs = await rest(`/repos/${LOGIN}/${repo.name}/languages`);
  const total = Object.values(langs).reduce((a, b) => a + b, 0);
  if (total === 0) continue;
  reposWithCode++;
  for (const [name, bytes] of Object.entries(langs)) {
    shares.set(name, (shares.get(name) ?? 0) + bytes / total);
  }
}
const top = [...shares.entries()]
  .map(([name, share]) => ({ name, pct: (100 * share) / reposWithCode }))
  .sort((a, b) => b.pct - a.pct)
  .slice(0, 8);

// --- Render SVG -------------------------------------------------------------
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => n.toLocaleString("es-MX");

const THEMES = {
  light: {
    surface: "#fcfcfb", border: "rgba(11,11,11,0.10)", primary: "#0b0b0b",
    secondary: "#52514e", muted: "#898781", grid: "#e1e0d9", accent: "#2a78d6",
  },
  dark: {
    surface: "#1a1a19", border: "rgba(255,255,255,0.10)", primary: "#ffffff",
    secondary: "#c3c2b7", muted: "#898781", grid: "#2c2c2a", accent: "#3987e5",
  },
};

function render(t) {
  const maxPct = Math.max(...top.map((l) => l.pct));
  const bars = top
    .map((l, i) => {
      const y = 76 + i * 20;
      const w = Math.max(8, Math.round((l.pct / maxPct) * 300));
      return `
  <text class="lang" x="418" y="${y + 10}" text-anchor="end">${esc(l.name)}</text>
  <path fill="${t.accent}" d="M430,${y} h${w - 4} a4,4 0 0 1 4,4 v4 a4,4 0 0 1 -4,4 h-${w - 4} z"/>
  <text class="pct" x="${430 + w + 8}" y="${y + 10}">${l.pct.toFixed(1)}%</text>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="248" viewBox="0 0 840 248" role="img" aria-label="Estadísticas de GitHub: ${fmt(contributions)} contribuciones en el último año, ${fmt(commits)} commits, ${repoCount} repositorios. Lenguajes ponderados por repositorio.">
  <title>Estadísticas de GitHub de Edgar Schaddaí</title>
  <style>
    text { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .title { font-size: 13px; font-weight: 600; fill: ${t.primary}; }
    .label { font-size: 12px; fill: ${t.muted}; }
    .value { font-size: 26px; font-weight: 600; fill: ${t.primary}; }
    .lang  { font-size: 11px; fill: ${t.secondary}; }
    .pct   { font-size: 11px; fill: ${t.secondary}; }
    .note  { font-size: 11px; fill: ${t.muted}; }
  </style>

  <rect x="0.5" y="0.5" width="839" height="247" rx="6" fill="${t.surface}" stroke="${t.border}"/>

  <text class="title" x="28" y="36">Actividad</text>
  <text class="label" x="28" y="72">Contribuciones · último año</text>
  <text class="value" x="28" y="100">${fmt(contributions)}</text>
  <text class="label" x="28" y="138">Commits</text>
  <text class="value" x="28" y="166">${fmt(commits)}</text>
  <text class="label" x="28" y="204">Repositorios</text>
  <text class="value" x="28" y="230">${repoCount}</text>

  <line x1="280.5" y1="28" x2="280.5" y2="228" stroke="${t.grid}" stroke-width="1"/>

  <text class="title" x="310" y="36">Lenguajes por proyecto</text>
  <text class="note" x="310" y="54">Ponderado por repositorio · incluye repositorios privados</text>
${bars}
</svg>
`;
}

mkdirSync("assets", { recursive: true });
writeFileSync("assets/stats-light.svg", render(THEMES.light), "utf8");
writeFileSync("assets/stats-dark.svg", render(THEMES.dark), "utf8");
console.log(`OK: ${fmt(contributions)} contribuciones, ${fmt(commits)} commits, ${repoCount} repos, ${top.length} lenguajes (${reposWithCode} repos con código).`);
