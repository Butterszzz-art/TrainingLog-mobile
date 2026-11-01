// Master Plan → Intake: which lead a client's plan is built from
// (coach/coach.js defaultLeadFor / leadOptionsHtml).
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync('coach/coach.js', 'utf8');
const start = src.indexOf('const planLeadKey');
const end = src.indexOf('function masterPlanCard(', start);

function setup(leads, stored = {}) {
  const store = { ...stored };
  const ctx = {
    _leads: leads,
    _planState: { clientId: 'u1' },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    escapeHtml: s => String(s),
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(start, end) + '\nthis.api = { defaultLeadFor, leadOptionsHtml, rememberPlanLead };', ctx);
  return { api: ctx.api, store };
}

const lead = (id, naam, extra = {}) => ({ id, naam, status: 'new', intake: { persoonsgegevens: { naam, email: extra.email || '' } }, ...extra });
const leads = [
  lead('L0', 'test delete me', { status: 'dismissed' }),
  lead('L1', 'Somebody Else'),
  lead('L2', 'Client A', { email: 'a@example.com', status: 'converted' }),
];
const client = { id: 'u1', clientName: 'someone', email: 'a@example.com' };

test('picks the lead whose email matches the client, not the first one', () => {
  expect(setup(leads).api.defaultLeadFor(client)).toBe('L2');
});

test("the plan's own lead wins, then the coach's last pick", () => {
  expect(setup(leads).api.defaultLeadFor(client, 'L1')).toBe('L1');
  expect(setup(leads, { coachPlanLead_u1: 'L1' }).api.defaultLeadFor(client)).toBe('L1');
  expect(setup(leads, { coachPlanLead_u1: 'gone' }).api.defaultLeadFor(client)).toBe('L2');
});

test('no match → nothing preselected; dismissed leads are hidden', () => {
  const { api } = setup(leads);
  expect(api.defaultLeadFor({ id: 'u1', clientName: 'nobody', email: '' })).toBe('');
  const html = api.leadOptionsHtml({ id: 'u1', clientName: 'nobody' }, '');
  expect(html).toMatch(/^<option value="">— Choose nobody’s intake —<\/option>/);
  expect(html).not.toContain('test delete me');
  expect(html).not.toContain('selected');
});

test('the matching lead is listed first and selected; the pick is remembered', () => {
  const { api, store } = setup(leads);
  const html = api.leadOptionsHtml(client, 'L2');
  expect(html.indexOf('Client A')).toBeLessThan(html.indexOf('Somebody Else'));
  expect(html).toContain('<option value="L2" selected>');
  api.rememberPlanLead({ value: 'L1' });
  expect(store.coachPlanLead_u1).toBe('L1');
});
