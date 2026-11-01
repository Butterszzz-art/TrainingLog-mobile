// Master Plan → Intake: which lead a client's plan is built from
// (coach/coach.js defaultLeadFor / leadOptionsHtml).
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync('coach/coach.js', 'utf8');
const start = src.indexOf('const planLeadKey');
const end = src.indexOf('function masterPlanCard(', start);
const body = src.slice(src.indexOf('function planFormBody('), src.indexOf('async function initMasterPlan('));

function setup(leads, stored = {}) {
  const store = { ...stored };
  const ctx = {
    _leads: leads,
    _planState: { clientId: 'u1' },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    escapeHtml: s => String(s),
    document: { getElementById: id => (ctx.fields || {})[id] || null },
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(start, end) + body + '\nthis.api = { defaultLeadFor, leadOptionsHtml, rememberPlanLead, parseIntakeFile, planFormBody, setFile: v => { _planIntakeFile = v; } };', ctx);
  return { api: ctx.api, store, ctx };
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

describe('intake from a file (no lead)', () => {
  const exported = { client: { id: 'x', naam: 'Client A', intake: { persoonsgegevens: { naam: 'Client A', gewicht: 84, vetpercentage: 18 } }, instellingen: { eiwitFactor: 2 }, calculations: {} } };

  test('reads a ClientIntake export, { intake } or a bare intake', () => {
    const { api } = setup(leads);
    expect(api.parseIntakeFile(JSON.stringify(exported))).toEqual({ intake: exported.client.intake, instellingen: { eiwitFactor: 2 }, naam: 'Client A' });
    expect(api.parseIntakeFile(JSON.stringify({ intake: exported.client.intake })).instellingen).toEqual({});
    expect(api.parseIntakeFile(JSON.stringify(exported.client.intake)).intake.persoonsgegevens.gewicht).toBe(84);
    expect(() => api.parseIntakeFile('nope')).toThrow(/isn’t JSON/);
    expect(() => api.parseIntakeFile('{"client":{}}')).toThrow(/No intake found/);
  });

  test('the dropdown offers the file, and the plan request sends the intake instead of a lead', () => {
    const { api, ctx } = setup(leads);
    expect(api.leadOptionsHtml(client, '')).toContain('Use intake file (.json)…');
    api.setFile({ clientId: 'u1', name: 'Client A (a.json)', intake: exported.client.intake, instellingen: { eiwitFactor: 2 } });
    expect(api.leadOptionsHtml(client, '__file')).toContain('<option value="__file" selected>From file: Client A (a.json)</option>');
    ctx.fields = { planLead: { value: '__file' }, planPackage: { value: 'cut_cycle_32' }, planStart: { value: '2026-11-09' }, planTier: { value: 'medium' } };
    const body = api.planFormBody('u1');
    expect(body).toMatchObject({ clientUid: 'u1', leadId: undefined, intake: exported.client.intake, instellingen: { eiwitFactor: 2 }, packageId: 'cut_cycle_32' });
  });
});
