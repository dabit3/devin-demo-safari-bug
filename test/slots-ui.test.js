const test = require('node:test');
const assert = require('node:assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const { createApp } = require('../server/app');

// Loads the real page and public/app.js against the real server. jsdom, like Safari,
// has no requestIdleCallback; the "Chrome" variant stubs one in.
async function loadPage({ withIdleCallback }) {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e));
  virtualConsole.on('error', (...args) => errors.push(args.join(' ')));
  const dom = await JSDOM.fromURL(base, {
    runScripts: 'dangerously',
    resources: 'usable',
    virtualConsole,
    beforeParse(window) {
      window.fetch = (url, opts) => fetch(new URL(url, base), opts);
      window.addEventListener('unhandledrejection', (e) => errors.push(e.reason));
      if (withIdleCallback) window.requestIdleCallback = (cb) => window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0);
      else delete window.requestIdleCallback;
    },
  });
  const close = () => { dom.window.close(); server.close(); };
  return { dom, errors, close };
}

async function waitFor(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

for (const browser of [{ name: 'Safari (no requestIdleCallback)', withIdleCallback: false }, { name: 'Chrome (requestIdleCallback)', withIdleCallback: true }]) {
  test(`renders time slots in ${browser.name}`, async (t) => {
    const { dom, errors, close } = await loadPage(browser);
    t.after(close);
    const doc = dom.window.document;
    const rendered = await waitFor(() => doc.querySelectorAll('#slots .slot').length > 0);
    assert.deepStrictEqual(errors.map(String), []);
    assert.ok(rendered, `slots never rendered; #slots shows: "${doc.getElementById('slots').textContent}"`);

    doc.querySelector('#slots .slot').click();
    doc.getElementById('name').value = 'Jane';
    doc.getElementById('name').dispatchEvent(new dom.window.Event('input'));
    assert.strictEqual(doc.getElementById('book').disabled, false);
  });
}

test('shows an error instead of loading forever when the slots request fails', async (t) => {
  const { dom, errors, close } = await loadPage({ withIdleCallback: false });
  t.after(close);
  const doc = dom.window.document;
  await waitFor(() => doc.querySelectorAll('#slots .slot').length > 0);
  dom.window.fetch = async () => { throw new TypeError('Load failed'); };
  doc.getElementById('day').dispatchEvent(new dom.window.Event('change'));
  assert.ok(await waitFor(() => /Couldn’t load times/.test(doc.getElementById('slots').textContent)));
  assert.strictEqual(errors.filter((e) => !/Failed to load times/.test(String(e))).length, 0);
});
