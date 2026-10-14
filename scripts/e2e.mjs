/**
 * End-to-end check of the demo flows in a real browser: setup from a
 * spreadsheet, grocery and medical changes, income cut, emergencies,
 * benchmark, importing a workbook made elsewhere, persistence, three
 * countries, cash book, the AI assistant (with a scripted stand-in for
 * Claude), start again, mobile layout and offline use.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   npx playwright install chromium   # first time only
 *   npm run e2e -- http://localhost:4173 ./e2e-shots
 */
const url = process.argv[2] || 'http://localhost:4173';
const shots = process.argv[3] || 'e2e-shots';
let chromium;
try {
  ({ chromium } = globalThis.__pw ?? (await import(process.env.PLAYWRIGHT_MODULE || 'playwright')));
} catch {
  console.error('Install Playwright first: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}
const fs = await import('node:fs');
fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on('console', (m) => m.text().startsWith('WIDE') && console.log(m.text()));
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// /api/chat 404s are expected: the static test server has no assistant backend.
page.on('console', (m) => m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_FAILED|ERR_INTERNET_DISCONNECTED|\/api\/chat/.test(m.text() + (m.location()?.url ?? '')) && errors.push(m.text()));

const results = [];
async function flow(name, fn) {
  try {
    await fn();
    results.push(`PASS ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `${shots}/FAIL-${name.slice(0, 1)}.png`, fullPage: true }).catch(() => {});
  }
}
const money = (s) => Number(String(s).replace(/[^0-9.\-−]/g, '').replace('−', '-'));
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('savvymoni:v1') || 'null'));
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const nav = async (hash) => {
  await page.evaluate((h) => (window.location.hash = h), hash);
  await page.waitForTimeout(150);
};

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();

await flow('A setup from a spreadsheet', async () => {
  await page.getByTestId('onboard-country-SG').click();
  expect((await page.getByTestId('all-templates').locator('button').count()) === 3, 'templates for all three countries not offered');
  await page.getByTestId('start-import').click();
  await page.screenshot({ path: `${shots}/A-import.png` });
  await page.getByTestId('use-sample').click();
  await page.getByTestId('import-review').waitFor();
  const counts = await page.getByTestId('import-counts').innerText();
  expect(/\d{3} transactions/.test(counts), `counts: ${counts}`);
  expect((await page.getByTestId('import-income').locator('input:checked').count()) >= 1, 'no income detected');
  expect((await page.getByTestId('import-bills').locator('input:checked').count()) >= 3, 'bills not detected');
  await page.getByTestId('import-name').fill('Aisyah');
  await page.screenshot({ path: `${shots}/A-review.png`, fullPage: true });
  await page.getByTestId('import-confirm').click();
  await page.getByTestId('hero').waitFor();
  const amt = await page.getByTestId('hero-amount').innerText();
  expect(!Number.isNaN(money(amt)), 'hero amount missing');
  const s = await stored();
  expect(s.onboarded && s.profile.displayName === 'Aisyah' && s.transactions.every((t) => t.source === 'imported'), 'state not built from the import');
  expect((await page.getByTestId('cushion-note').innerText()).includes('kept as a cushion'), 'cushion not explained');
  expect((await page.getByTestId('trend-empty').count()) === 0, 'savings history not worked out from transfers');
  expect((await page.getByText(/worked out from 2 transfers/).count()) === 1, 'trend basis not shown');
  await page.screenshot({ path: `${shots}/A-overview.png`, fullPage: true });
});

await flow('P save any amount, undo, and the logo', async () => {
  const before = await stored();
  const em = (x) => x.accounts.filter((a) => a.role === 'emergency').reduce((t, a) => t + a.balanceCents, 0);
  // Above the safe maximum needs a second press.
  await page.getByTestId('save-amount').fill('5000');
  await page.getByTestId('save-over').waitFor();
  await page.getByTestId('record-saving').click();
  expect(em(await stored()) === em(before), 'saved above the safe maximum without confirming');
  // The safe maximum is allowed directly.
  await page.getByTestId('save-max').click();
  await page.getByTestId('record-saving').click();
  const saved = await stored();
  expect(em(saved) > em(before), 'saving not recorded');
  await page.getByTestId('undo-saving').click();
  const undone = await stored();
  expect(em(undone) === em(before) && undone.contributions.length === before.contributions.length, 'undo did not restore balances');
  // Logo goes back to the start page; the plan is kept.
  await page.getByTestId('brand-home').first().click();
  await page.getByTestId('existing-plan').waitFor();
  await page.screenshot({ path: `${shots}/P-start-page.png`, fullPage: true });
  await page.getByTestId('start-import').click();
  await page.getByTestId('replace-confirm').waitFor();
  await page.getByTestId('back-to-plan').click();
  await page.getByTestId('hero').waitFor();
  expect((await stored()).transactions.length === undone.transactions.length, 'plan changed by visiting the start page');
});

await flow('D income reduction', async () => {
  await nav('finances');
  const inc = (await stored()).incomeSources[0];
  const before = money(await page.getByTestId('live-rec-amount').innerText());
  await page.getByTestId(`income-amount-${inc.id}`).fill('150');
  await page.getByTestId(`income-save-${inc.id}`).click();
  await page.waitForTimeout(200);
  const after = money(await page.getByTestId('live-rec-amount').innerText());
  expect(after < before, `expected lower contribution (${before} -> ${after})`);
  const status = await page.getByTestId('live-rec').getByTestId('status-pill').innerText();
  await page.screenshot({ path: `${shots}/D-income-cut.png` });
  results.push(`     D: S$${before} -> S$${after} (${status})`);
  // Put the income back for the next flows.
  await page.getByTestId(`income-amount-${inc.id}`).fill(String(inc.netAmountCents / 100));
  await page.getByTestId(`income-save-${inc.id}`).click();
  expect(money(await page.getByTestId('live-rec-amount').innerText()) === before, 'income not restored');
});

await flow('B grocery purchase', async () => {
  await nav('insights');
  await page.getByRole('button', { name: 'Groceries' }).click();
  expect((await page.getByTestId('fairprice-history').locator('.list-row').count()) > 3, 'no grocery history');
  const before = money(await page.getByTestId('live-rec-amount').innerText());
  await page.getByTestId('add-purchase').click();
  await page.getByTestId('purchase-groceries').fill('180');
  await page.getByTestId('purchase-save').click();
  await page.waitForTimeout(200);
  const after = money(await page.getByTestId('live-rec-amount').innerText());
  const s = await stored();
  expect(s.history.at(-1).reason.includes('FairPrice') || after !== before || s.transactions[0].merchant.includes('FairPrice'), 'recommendation did not respond');
  expect(after <= before, `expected safe-to-save to fall (${before} -> ${after})`);
  await page.screenshot({ path: `${shots}/B-groceries.png`, fullPage: true });
});

await flow('C healthcare shock', async () => {
  await nav('planner');
  const maxBefore = money(await page.getByTestId('planner-max').innerText());
  await nav('insights');
  await page.getByRole('button', { name: 'Healthcare' }).click();
  await page.getByTestId('add-medical').click();
  await page.getByTestId('medical-save').click();
  await nav('planner');
  const maxAfter = money(await page.getByTestId('planner-max').innerText());
  expect(maxAfter <= maxBefore - 400 + 0.01 || maxAfter === 0, `max safe ${maxBefore} -> ${maxAfter}`);
  const emBefore = (await stored()).accounts.filter((a) => a.role === 'emergency').reduce((t, a) => t + a.balanceCents, 0);
  await nav('simulator');
  await page.getByTestId('preset-dental').click();
  await page.getByTestId('apply-shock').click();
  await page.getByTestId('apply-shock-confirm').click();
  await page.getByTestId('scenarios').waitFor();
  const emAfter = (await stored()).accounts.filter((a) => a.role === 'emergency').reduce((t, a) => t + a.balanceCents, 0);
  expect(emAfter < emBefore, 'emergency savings unchanged');
  await page.screenshot({ path: `${shots}/C-recovery-after-dental.png`, fullPage: true });
});

await flow('E emergency recovery', async () => {
  await nav('simulator');
  await page.getByTestId('preset-vehicle').click();
  await page.screenshot({ path: `${shots}/E-simulator.png`, fullPage: true });
  await page.getByTestId('apply-shock').click();
  await page.getByTestId('apply-shock-confirm').click();
  await page.getByTestId('scenarios').waitFor();
  expect(money(await page.getByTestId('recovery-gap').innerText()) > 0, 'no gap to rebuild');
  await page.screenshot({ path: `${shots}/E-recovery.png`, fullPage: true });
});

await flow('F benchmark', async () => {
  await nav('benchmark');
  const before = await page.getByTestId('bench-table').innerText();
  await page.getByTestId('bench-income-cut').click();
  await page.getByTestId('bench-medical').click();
  const after = await page.getByTestId('bench-table').innerText();
  expect(before !== after, 'benchmark did not react');
  await page.screenshot({ path: `${shots}/F-benchmark.png`, fullPage: true });
});

await flow('G import a workbook made in another program', async () => {
  await nav('integrations');
  const n0 = (await stored()).transactions.length;
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles(new URL('../tests/fixtures/openpyxl-statement.xlsx', import.meta.url).pathname);
  await page.getByTestId('import-review').waitFor();
  const counts = await page.getByTestId('import-counts').innerText();
  expect(counts.includes('6 transactions'), `counts: ${counts}`);
  await page.screenshot({ path: `${shots}/G-import-preview.png`, fullPage: true });
  await page.getByTestId('import-confirm').click();
  const s = await stored();
  expect(s.transactions.length === n0 + 6, `imported count wrong: ${n0} -> ${s.transactions.length}`);
  expect(s.accounts.some((a) => a.name === 'Rainy day' && a.role === 'emergency'), 'balances sheet not applied');
});

await flow('H persistence', async () => {
  const before = await stored();
  await page.reload();
  await page.getByTestId('hero').or(page.locator('.page')).first().waitFor();
  const s = await stored();
  expect(s.profile.displayName === 'Aisyah', 'profile lost');
  expect(s.transactions.length === before.transactions.length, 'records lost after reload');
  expect(s.shocks.length === 2, 'shocks lost after reload');
});

const emergencyOf = (s) => s.accounts.filter((a) => a.role === 'emergency').reduce((t, a) => t + a.balanceCents, 0);
const liquidOf = (s) => s.accounts.filter((a) => a.role === 'spending').reduce((t, a) => t + a.balanceCents, 0);

await flow('J country switching keeps each currency', async () => {
  const sg = await stored();
  await page.getByTestId('country-select').selectOption('PH');
  // A country without records starts at setup, never with built-in data.
  await page.getByTestId('start-import').click();
  await page.getByTestId('use-sample').click();
  await page.getByTestId('import-review').waitFor();
  expect((await page.getByTestId('import-review').innerText()).includes('₱'), 'peso amounts missing in review');
  await page.getByTestId('import-confirm').click();
  await page.getByTestId('hero').waitFor();
  expect((await page.getByTestId('hero-amount').innerText()).includes('₱'), 'peso symbol missing');
  let s = await stored();
  expect(s.marketCode === 'PH' && s.transactions.length > 100, 'PH import not applied');
  await page.screenshot({ path: `${shots}/J-philippines.png`, fullPage: true });
  await page.getByTestId('country-select').selectOption('MM');
  await page.getByTestId('start-cash').click();
  await page.getByTestId('cash-start').fill('450000');
  await page.getByTestId('cash-savings').fill('100000');
  await page.getByTestId('cash-daily').fill('55000');
  await page.getByTestId('cash-confirm').click();
  await page.getByTestId('cash-amount').waitFor();
  s = await stored();
  expect(s.marketCode === 'MM' && liquidOf(s) === 450000 && emergencyOf(s) === 100000, 'MM cash book not started');
  await page.getByTestId('country-select').selectOption('SG');
  await nav('overview');
  await page.getByTestId('hero').waitFor();
  s = await stored();
  expect(s.marketCode === 'SG' && s.profile.displayName === sg.profile.displayName, 'SG state not restored');
  expect(liquidOf(s) === liquidOf(sg) && emergencyOf(s) === emergencyOf(sg), 'SG balances changed after switching');
  expect(s.transactions.length === sg.transactions.length, 'SG records changed after switching');
});

await flow('K cash book (Myanmar, cash and overtime)', async () => {
  await page.getByTestId('country-select').selectOption('MM');
  await nav('cashbook');
  const before = await stored();
  const recBefore = await page.getByTestId('live-rec-amount').innerText();
  await page.getByTestId('cash-dir-in').click();
  await page.getByTestId('cash-amount').fill('200000');
  await page.getByTestId('cash-pick-Wages').click();
  await page.getByTestId('cash-save').click();
  await page.getByTestId('cash-dir-out').click();
  await page.getByTestId('cash-amount').fill('150,000');
  await page.getByTestId('cash-pick-Rice and oil').click();
  await page.getByTestId('cash-save').click();
  const after = await stored();
  expect(liquidOf(after) === liquidOf(before) + 200000 - 150000, `cash balance wrong: ${liquidOf(before)} -> ${liquidOf(after)}`);
  expect(after.transactions.length === before.transactions.length + 2, 'entries not recorded');
  // A reason of the user's own.
  await page.getByTestId('cash-amount').fill('35000');
  await page.getByTestId('cash-pick-custom').click();
  await page.getByTestId('cash-custom-text').fill('School shoes');
  await page.getByTestId('cash-custom-cat').selectOption('family');
  await page.getByTestId('cash-save').click();
  const custom = (await stored()).transactions.find((t) => t.merchant === 'School shoes');
  expect(custom && custom.amountCents === -35000 && custom.category === 'family', 'custom entry not saved');
  await page.screenshot({ path: `${shots}/K-cashbook.png`, fullPage: true });
  // Too few entries for regular income or bills: the finder says so instead of guessing.
  await page.getByTestId('pattern-scan').click();
  await page.getByTestId('pattern-none').waitFor();
  await page.getByRole('button', { name: 'By week' }).first().click();
  await page.getByTestId('cash-weekly').waitFor();
  results.push(`     K: safe-to-save ${recBefore} -> ${await page.getByTestId('live-rec-amount').innerText()}`);
});

await flow('L ASEAN three-country demo', async () => {
  await nav('asean');
  await page.getByTestId('asean-MM').waitFor();
  const t = await page.getByTestId('asean-columns').innerText();
  expect(t.includes('S$') && t.includes('₱') && t.includes('K'), 'currencies missing');
  expect(!(await page.getByTestId('asean-SG').innerText()).includes('Sample'), 'should use the user\'s own Singapore records');
  const before = await page.getByTestId('asean-MM').innerText();
  await page.getByTestId('asean-severity').fill('200');
  const after = await page.getByTestId('asean-MM').innerText();
  expect(before !== after, 'severity did not change results');
  await page.screenshot({ path: `${shots}/L-asean.png`, fullPage: true });
});

const cornerLangs = async () => page.getByTestId('language-select-corner').locator('option').evaluateAll((o) => o.map((x) => x.value).join(','));

await flow('N Singapore languages in the corner drop-down', async () => {
  await page.getByTestId('country-select').selectOption('SG');
  await nav('overview');
  expect((await cornerLangs()) === 'en,zh,ms,ta', `Singapore languages wrong: ${await cornerLangs()}`);
  await page.getByTestId('language-select-corner').selectOption('zh');
  await page.getByText('现金账簿').first().waitFor();
  expect((await page.evaluate(() => document.documentElement.lang)) === 'zh-Hans', 'html lang not set');
  await page.screenshot({ path: `${shots}/N-chinese.png` });
  await page.getByTestId('language-select-corner').selectOption('ms');
  await page.getByText('Buku tunai').first().waitFor();
  await page.getByTestId('language-select-corner').selectOption('ta');
  await page.getByText('பணப் பதிவேடு').first().waitFor();
  await page.screenshot({ path: `${shots}/N-tamil.png` });
  await page.getByTestId('language-select-corner').selectOption('en');
});

await flow('Q Filipino and Burmese, English when switching', async () => {
  await page.getByTestId('country-select').selectOption('PH');
  expect((await cornerLangs()) === 'en,fil', `Philippine languages wrong: ${await cornerLangs()}`);
  await page.getByTestId('language-select-corner').selectOption('fil');
  await page.getByText('Talaan ng pera').first().waitFor();
  await page.getByTestId('country-select').selectOption('MM');
  expect((await cornerLangs()) === 'en,my', `Myanmar languages wrong: ${await cornerLangs()}`);
  expect((await stored()).settings.language === 'en', 'Filipino carried into Myanmar');
  await page.getByTestId('language-select-corner').selectOption('my');
  await page.getByText('ငွေစာရင်း').first().waitFor();
  const s = await stored();
  expect(s.settings.simpleMode === true, 'Myanmar should start in simple mode');
  await page.screenshot({ path: `${shots}/Q-burmese.png` });
  await page.getByTestId('country-select').selectOption('SG');
  await nav('overview');
  await page.getByTestId('hero').waitFor();
  expect((await stored()).settings.language === 'en', 'Burmese carried into Singapore');
});

await flow('O AI assistant (scripted stand-in for Claude)', async () => {
  // Without a Claude connection the assistant says so, with no pre-written answers.
  await nav('assistant');
  await page.getByTestId('ai-unavailable').waitFor();
  expect((await page.getByTestId('chat-input').count()) === 0, 'chat shown without a connection');
  // Stand in for the server proxy: first a tool call, then an answer built from the tool result.
  let posts = 0;
  await page.route('**/api/chat', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { configured: true, model: 'test' } });
    posts++;
    const body = req.postDataJSON();
    const last = body.messages.at(-1);
    if (typeof last.content === 'string') return route.fulfill({ json: { content: [{ type: 'tool_use', id: 't1', name: 'get_plan_summary', input: {} }], stop_reason: 'tool_use' } });
    const plan = JSON.parse(last.content[0].content);
    return route.fulfill({ json: { content: [{ type: 'text', text: `You can safely save **${plan.safe_to_save_now}** now.\n\n- Spending money: ${plan.spending_money_now}` }], stop_reason: 'end_turn' } });
  });
  await page.reload();
  await nav('assistant');
  await page.getByTestId('ai-consent').waitFor();
  await page.screenshot({ path: `${shots}/O-consent.png`, fullPage: true });
  await page.getByTestId('ai-agree').check();
  await page.getByTestId('ai-enable').click();
  await page.getByTestId('chat-input').fill('How much can I save today?');
  await page.getByTestId('chat-send').click();
  const msg = page.getByTestId('bot-msg').last();
  await msg.getByText('You can safely save').waitFor();
  const text = await msg.innerText();
  await nav('overview');
  const hero = await page.getByTestId('hero-amount').innerText();
  expect(text.includes(hero.trim()), `assistant (${text}) disagrees with the engine (${hero})`);
  expect(text.includes('Checking your safe-to-save plan'), 'data used not shown');
  expect(posts === 2, `expected 2 requests, saw ${posts}`);
  await nav('assistant');
  await page.screenshot({ path: `${shots}/O-assistant.png`, fullPage: true });
  await page.unroute('**/api/chat');
});

await flow('I start again', async () => {
  await nav('settings');
  await page.getByTestId('reset-all').click();
  await page.getByTestId('reset-all-confirm').click();
  await page.getByTestId('start-import').waitFor();
  const s = await stored();
  expect(!s.onboarded && s.transactions.length === 0 && s.accounts.length === 0, 'not reset');
});

// Extra views for review
await page.getByTestId('start-import').click();
await page.getByTestId('use-sample').click();
await page.getByTestId('import-confirm').click();
await page.getByTestId('hero').waitFor();
for (const r of ['planner', 'finances', 'integrations', 'settings']) {
  await nav(r);
  await page.screenshot({ path: `${shots}/view-${r}.png`, fullPage: true });
}
await page.setViewportSize({ width: 390, height: 844 });
for (const r of ['overview', 'integrations']) {
  await nav(r);
  await page.screenshot({ path: `${shots}/mobile-${r}.png`, fullPage: true });
}
const overflow = await page.evaluate(() => {
  const w = window.innerWidth;
  const wide = [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > w + 1 && !el.closest('.table-wrap'));
  if (wide.length) console.log('WIDE', wide.slice(0, 5).map((el) => el.className + ' ' + Math.round(el.getBoundingClientRect().right)).join(' | '));
  return document.documentElement.scrollWidth > w + 1;
});
results.push(overflow ? 'FAIL mobile: horizontal overflow' : 'PASS mobile: no horizontal overflow');
await page.emulateMedia({ colorScheme: 'dark' });
await page.setViewportSize({ width: 1360, height: 900 });
await page.screenshot({ path: `${shots}/dark-overview.png`, fullPage: false });

// Offline: load once online so the service worker caches the app, then cut the network.
// Set SKIP_OFFLINE=1 when testing a build without the service worker (e.g. the single-file hosted demo).
if (!process.env.SKIP_OFFLINE) await flow('M offline (network disabled)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push('offline page: ' + String(e)));
  await p.goto(url);
  await p.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('no service worker')), 15000))]));
  await p.reload();
  await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await ctx.setOffline(true);
  await p.reload();
  await p.getByTestId('onboard-country-MM').click();
  await p.getByTestId('start-cash').click();
  await p.getByTestId('cash-start').fill('300000');
  await p.getByTestId('cash-daily').fill('50000');
  await p.getByTestId('cash-confirm').click();
  await p.getByTestId('cash-amount').waitFor();
  const badge = await p.getByTestId('connectivity').first().innerText();
  expect(/offline/i.test(badge), `badge says ${badge}`);
  await p.getByTestId('cash-amount').fill('50000');
  await p.getByTestId('cash-pick-Rice and oil').click();
  await p.getByTestId('cash-save').click();
  const s = await p.evaluate(() => JSON.parse(localStorage.getItem('savvymoni:v1')));
  expect(s.transactions.some((t) => t.merchant === 'Rice and oil' && t.amountCents === -50000), 'offline entry not saved');
  await p.screenshot({ path: `${shots}/M-offline.png`, fullPage: true });
  results.push(`     M: reloaded with network off; badge "${badge}"`);
  await ctx.close();
});

console.log(results.join('\n'));
console.log(errors.length ? `Console errors:\n${errors.join('\n')}` : 'No console errors');
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
