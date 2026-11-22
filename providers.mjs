// Doctor search + network check for the Veteran Insurance Solutions site.
//   GET /api/providers/search?name=John%20Smith&zip=32827  -> list of doctors (CMS NPI Registry, free, no key)
//   GET /api/providers/network?npi=123&plans=H7617-108-000,...  -> {planId:"in"|"out"|"unknown"}
// Network checks need carrier directory access (Humana key goes in Netlify "Keys and secrets" as HUMANA_API_KEY).
export const config = { path: "/api/providers/*" };

const NPPES = "https://npiregistry.cms.hhs.gov/api/";
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });

function stateForZip(zip) {
  const z = parseInt(String(zip).slice(0, 3), 10);
  if (z >= 320 && z <= 349) return "FL";
  return "";
}

function clean(s) { return String(s || "").trim(); }
function title(s) { return clean(s).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()); }

async function search(url) {
  const raw = clean(url.searchParams.get("name")).replace(/^dr\.?\s+/i, "").replace(/[,.]/g, " ");
  const zip = clean(url.searchParams.get("zip")).slice(0, 5);
  const toks = raw.split(/\s+/).filter(Boolean);
  if (!toks.length) return json([]);
  const last = toks[toks.length - 1];
  const first = toks.length > 1 ? toks[0] : "";
  const q = new URLSearchParams({ version: "2.1", enumeration_type: "NPI-1", limit: "200" });
  q.set("last_name", last.length >= 2 ? last + "*" : last);
  if (first) q.set("first_name", first.length >= 2 ? first + "*" : first);
  const st = stateForZip(zip);
  if (st) q.set("state", st);
  const r = await fetch(NPPES + "?" + q.toString());
  if (!r.ok) return json({ error: "registry " + r.status }, 502);
  const data = await r.json();
  const rows = (data.results || []).map((x) => {
    const b = x.basic || {};
    const loc = (x.addresses || []).find((a) => a.address_purpose === "LOCATION") || (x.addresses || [])[0] || {};
    const tax = (x.taxonomies || []).find((t) => t.primary) || (x.taxonomies || [])[0] || {};
    const cred = clean(b.credential).replace(/\./g, "");
    const name = [title(b.first_name), title(b.last_name)].filter(Boolean).join(" ") + (cred ? ", " + cred : "");
    return {
      npi: String(x.number || ""),
      name,
      last: title(b.last_name),
      first: title(b.first_name),
      specialty: clean(tax.desc),
      address: title(loc.address_1),
      city: title(loc.city),
      state: clean(loc.state),
      zip: clean(loc.postal_code).slice(0, 5),
    };
  }).filter((d) => !st || d.state === st);
  const score = (d) => (d.zip === zip ? 0 : d.zip.slice(0, 3) === zip.slice(0, 3) ? 1 : 2);
  rows.sort((a, b) => score(a) - score(b) || a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
  return json(rows.slice(0, 25));
}

async function network(url) {
  const plans = clean(url.searchParams.get("plans")).split(",").filter(Boolean);
  const out = {};
  // Not connected yet: answers "unknown" (the site shows "Verify with plan") until the Humana key is added.
  for (const p of plans) out[p] = "unknown";
  return json(out);
}

export default async (req) => {
  const url = new URL(req.url);
  try {
    if (url.pathname.endsWith("/search")) return await search(url);
    if (url.pathname.endsWith("/network")) return await network(url);
    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};
