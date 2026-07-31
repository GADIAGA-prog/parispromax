const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const read = (name) => fs.readFileSync(path.join(publicDir, name), 'utf8');

test('la page publique expose les signaux essentiels pour les moteurs de recherche', () => {
  const html = read('index.html');

  assert.match(html, /<title>ParisPromax \| Pronostics PMU Burkina Faso et résultats<\/title>/);
  assert.match(html, /name="robots" content="index, follow/);
  assert.match(html, /rel="canonical" href="https:\/\/www\.parispromax\.com\/"/);
  assert.match(html, /rel="sitemap"[^>]+sitemap\.xml/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"@type": "Organization"/);
  assert.match(html, /"@type": "WebSite"/);
  assert.match(html, /"@type": "WebApplication"/);
});

test('robots.txt autorise la recherche et déclare le sitemap canonique', () => {
  const robots = read('robots.txt');

  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Allow: \//);
  assert.doesNotMatch(robots, /Disallow: \/\s*$/m);
  assert.match(robots, /Sitemap: https:\/\/www\.parispromax\.com\/sitemap\.xml/);
});

test('le sitemap contient uniquement les pages publiques canoniques', () => {
  const sitemap = read('sitemap.xml');

  assert.match(sitemap, /<loc>https:\/\/www\.parispromax\.com\/<\/loc>/);
  assert.match(sitemap, /<changefreq>daily<\/changefreq>/);
  assert.match(sitemap, /\/legal\/privacy/);
  assert.match(sitemap, /\/legal\/responsible-gambling/);
  assert.doesNotMatch(sitemap, /onrender\.com|download\/android/);
});
