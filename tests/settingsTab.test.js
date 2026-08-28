const { JSDOM } = require('jsdom');
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');

let dom;

beforeAll(() => {
  dom = new JSDOM(html, { runScripts: 'outside-only' });

  // implement simplified tab switching
  dom.window.showTab = function(tabName) {
    dom.window.document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    const tab = dom.window.document.getElementById(tabName);
    if (tab) tab.classList.add('active');
  };

  // Settings navigation lives in the "All" hub tab (formerly the "More"
  // drawer) as of the Modernist redesign. Current markup:
  // <button class="pod all-hub-tile" data-tab="settingsTab"
  //   onclick="showTab('settingsTab')">
  // Mimic the onclick synchronously (the inline attribute doesn't execute
  // under runScripts: 'outside-only') rather than relying on it directly.
  dom.window.document.querySelectorAll('.all-hub-tile[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      dom.window.showTab(btn.getAttribute('data-tab'));
    });
  });
});

test('clicking Settings link shows settings tab', () => {
  const settingsLink = dom.window.document.querySelector('.all-hub-tile[data-tab="settingsTab"]');
  const settingsTab = dom.window.document.getElementById('settingsTab');

  expect(settingsLink).not.toBeNull();
  expect(settingsTab.classList.contains('active')).toBe(false);

  // simulate click
  settingsLink.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  expect(settingsTab.classList.contains('active')).toBe(true);
});
