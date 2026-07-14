const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const Imap = require('imap');
const { simpleParser } = require('mailparser');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_VERCEL = !!process.env.VERCEL;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ====== Database (JSON File local, Upstash Redis on Vercel) ======
const USE_UPSTASH = !!process.env.UPSTASH_REDIS_REST_URL;

function createFreshDB() {
  return {
    users: [{ id: '1101', username: '1101', password: '1101', name: 'Admin', role: 'Super Admin', roles: ['Super Admin','Support Desk','Workflow Coordinator','Upload Manager','Download Manager'], passChanged: false, createdBy: 'system' }],
    tickets: [],
    orders: [],
    messages: [],
    feedbacks: [],
    pendingDeletes: [],
    emailLogs: [],
    nextId: { ticket: 100, order: 1000, feedback: 100, user: 100 }
  };
}

async function upstashGet(key) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/get/${key}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function upstashSet(key, value) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/set/${key}`;
  await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(value))
  });
}

const DB_KEY = 'cortex_db';
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

async function db() {
  if (USE_UPSTASH) {
    let data = await upstashGet(DB_KEY);
    if (!data) { data = createFreshDB(); await upstashSet(DB_KEY, data); }
    return JSON.parse(JSON.stringify(data));
  }
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) { const fresh = createFreshDB(); fs.writeFileSync(DB_FILE, JSON.stringify(fresh, null, 2)); return JSON.parse(JSON.stringify(fresh)); }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch { return createFreshDB(); }
}

async function dbSave(d) {
  if (USE_UPSTASH) { await upstashSet(DB_KEY, d); return; }
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); } catch {}
}

async function nextId(seq) {
  const data = await db();
  const n = (data.nextId[seq] || 100) + 1;
  data.nextId[seq] = n;
  await dbSave(data);
  return n;
}

// ====== Email Masking ======
function maskEmail(fromStr) {
  const match = fromStr.match(/<([^>]+)>/);
  const email = match ? match[1] : fromStr;
  const name = match ? fromStr.replace(/<[^>]+>/, '').trim() : '';
  const parts = email.split('@');
  if (parts.length !== 2) return fromStr;
  const local = parts[0];
  const domain = parts[1];
  const maskedLocal = local.length > 2 ? local[0] + '***' + local.slice(-1) : local[0] + '***';
  const maskedEmail = maskedLocal + '@' + domain;
  return name ? `${name} <${maskedEmail}>` : maskedEmail;
}

// ====== Slack Webhook ======
async function getSlackConfig() {
  const d = await db();
  return d.slackConfig || { webhookUrl: '', enabled: false };
}

async function notifySlack(message) {
  const cfg = await getSlackConfig();
  if (!cfg.enabled || !cfg.webhookUrl) return;
  const payload = JSON.stringify({ text: message });
  const url = new URL(cfg.webhookUrl);
  const mod = url.protocol === 'https:' ? https : http;
  const opts = { hostname: url.hostname, path: url.pathname + url.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } };
  const req = mod.request(opts, res => { let body = ''; res.on('data', c => body += c); res.on('end', () => { if (res.statusCode >= 400) console.error('Slack webhook error:', body); }); });
  req.on('error', e => console.error('Slack notify error:', e.message));
  req.write(payload);
  req.end();
}

app.get('/api/slack-config', async (req, res) => {
  const cfg = await getSlackConfig();
  res.json({ webhookUrl: cfg.webhookUrl ? cfg.webhookUrl.substring(0, 10) + '...' : '', enabled: cfg.enabled, configured: !!cfg.webhookUrl });
});

app.post('/api/slack-config', async (req, res) => {
  const { webhookUrl, enabled } = req.body;
  const d = await db();
  d.slackConfig = { webhookUrl: webhookUrl || '', enabled: enabled !== false };
  await dbSave(d);
  res.json({ ok: true });
});

// ====== Auth ======
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const data = await db();
  const user = data.users.find(x => (x.username === username || x.id === username) && x.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const safe = { ...user };
  delete safe.password;
  res.json({ user: safe, needsPassChange: !user.passChanged });
});

app.post('/api/change-password', async (req, res) => {
  const { userId, password } = req.body;
  const data = await db();
  const user = data.users.find(x => x.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.password = password;
  user.passChanged = true;
  await dbSave(data);
  res.json({ ok: true });
});

app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  const data = await db();
  if (data.users.find(x => x.username === email)) return res.status(400).json({ error: 'Email already registered' });
  const id = 'U' + await nextId('user');
  data.users.push({ id, username: email, password, name, role: 'Support Desk', roles: ['Support Desk'], passChanged: true, createdBy: 'self' });
  await dbSave(data);
  res.json({ ok: true, id });
});

// ====== Users ======
app.get('/api/users', async (req, res) => {
  const data = await db();
  res.json(data.users.map(u => { const s = { ...u }; delete s.password; return s; }));
});

app.post('/api/users', async (req, res) => {
  const { name, email, role, createdBy } = req.body;
  const data = await db();
  const id = 'U' + await nextId('user');
  data.users.push({ id, username: email, password: 'pixofix', name, role, roles: [role], passChanged: false, createdBy: createdBy || '1101' });
  await dbSave(data);
  res.json({ ok: true, id });
});

app.put('/api/users/:id', async (req, res) => {
  const data = await db();
  const user = data.users.find(x => x.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (req.body.name) user.name = req.body.name;
  if (req.body.role) { user.role = req.body.role; user.roles = [req.body.role]; }
  await dbSave(data);
  res.json({ ok: true });
});

app.put('/api/users/:id/reset-pass', async (req, res) => {
  const data = await db();
  const user = data.users.find(x => x.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  user.password = 'pixofix';
  user.passChanged = false;
  await dbSave(data);
  res.json({ ok: true });
});

app.delete('/api/users/:id', async (req, res) => {
  if (req.params.id === '1101') return res.status(400).json({ error: 'Cannot delete primary admin' });
  const data = await db();
  data.users = data.users.filter(x => x.id !== req.params.id);
  await dbSave(data);
  res.json({ ok: true });
});

// ====== CRUD helpers ======
function crudHandlers(collection, idPrefix) {
  app.get(`/api/${collection}`, async (req, res) => {
    const data = await db();
    res.json(data[collection] || []);
  });
  app.post(`/api/${collection}`, async (req, res) => {
    const data = await db();
    const id = idPrefix + await nextId(collection);
    const now = new Date().toISOString();
    const item = { id, ...req.body, createdAt: now, updatedAt: now };
    if (!data[collection]) data[collection] = [];
    data[collection].push(item);
    await dbSave(data);
    res.json({ ok: true, id });
  });
  app.put(`/api/${collection}/:id`, async (req, res) => {
    const data = await db();
    const items = data[collection] || [];
    const idx = items.findIndex(x => x.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    items[idx] = { ...items[idx], ...req.body, id: req.params.id, updatedAt: new Date().toISOString() };
    await dbSave(data);
    res.json({ ok: true });
  });
  app.delete(`/api/${collection}/:id`, async (req, res) => {
    const data = await db();
    data[collection] = (data[collection] || []).filter(x => x.id !== req.params.id);
    await dbSave(data);
    res.json({ ok: true });
  });
}

crudHandlers('tickets', 'T');
crudHandlers('orders', 'O');
crudHandlers('feedbacks', 'F');

// ====== Messages ======
app.get('/api/messages', async (req, res) => {
  const data = await db();
  res.json((data.messages || []).sort((a, b) => a.createdAt < b.createdAt ? -1 : 1));
});

app.post('/api/messages', async (req, res) => {
  const { fromUser, toUser, text, threadId } = req.body;
  const data = await db();
  if (!data.messages) data.messages = [];
  data.messages.push({ id: uuidv4(), fromUser, toUser, text, threadId: threadId || '', createdAt: new Date().toISOString() });
  await dbSave(data);
  res.json({ ok: true });
});

// ====== Pending Deletes ======
app.get('/api/pending-deletes', async (req, res) => {
  const data = await db();
  res.json(data.pendingDeletes || []);
});

app.post('/api/pending-deletes', async (req, res) => {
  const { refType, refId, label, requestedBy } = req.body;
  const data = await db();
  if (!data.pendingDeletes) data.pendingDeletes = [];
  data.pendingDeletes.push({ id: uuidv4(), refType, refId, label, requestedBy, requestedAt: new Date().toISOString() });
  await dbSave(data);
  res.json({ ok: true });
});

app.post('/api/pending-deletes/:id/approve', async (req, res) => {
  const data = await db();
  const idx = (data.pendingDeletes || []).findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const item = data.pendingDeletes[idx];
  const collMap = { ticket: 'tickets', order: 'orders', feedback: 'feedbacks' };
  const coll = collMap[item.refType];
  if (coll && data[coll]) data[coll] = data[coll].filter(x => x.id !== item.refId);
  data.pendingDeletes.splice(idx, 1);
  await dbSave(data);
  res.json({ ok: true });
});

app.post('/api/pending-deletes/:id/reject', async (req, res) => {
  const data = await db();
  data.pendingDeletes = (data.pendingDeletes || []).filter(x => x.id !== req.params.id);
  await dbSave(data);
  res.json({ ok: true });
});

// ====== Email Account Management (multiple inboxes) ======
async function getEmailAccounts() {
  const d = await db();
  return d.imapAccounts || [];
}

async function saveEmailAccounts(accounts) {
  const d = await db();
  d.imapAccounts = accounts;
  await dbSave(d);
}

app.get('/api/imap-accounts', async (req, res) => {
  const accounts = await getEmailAccounts();
  res.json(accounts.map(a => ({ id: a.id, label: a.label, host: a.host, user: a.user, configured: true })));
});

app.post('/api/imap-accounts', async (req, res) => {
  const { label, host, port, user, pass } = req.body;
  const accounts = await getEmailAccounts();
  const id = uuidv4();
  accounts.push({ id, label: label || user, host, port: port || 993, user, pass });
  await saveEmailAccounts(accounts);
  res.json({ ok: true, id });
});

app.delete('/api/imap-accounts/:id', async (req, res) => {
  const accounts = await getEmailAccounts();
  await saveEmailAccounts(accounts.filter(a => a.id !== req.params.id));
  res.json({ ok: true });
});

// ====== Auto-Email Polling ======
let autoEmailTimer = null;
let pollingActive = false;

async function getAutoEmailConfig() {
  const d = await db();
  return d.autoEmailConfig || { enabled: false, intervalMs: 120000 };
}

async function saveAutoEmailConfig(cfg) {
  const d = await db();
  d.autoEmailConfig = cfg;
  await dbSave(d);
}

app.get('/api/auto-email-config', async (req, res) => {
  res.json(await getAutoEmailConfig());
});

app.post('/api/auto-email-config', async (req, res) => {
  const { enabled, intervalMs } = req.body;
  await saveAutoEmailConfig({ enabled: enabled !== false, intervalMs: intervalMs || 120000 });
  if (!IS_VERCEL) restartAutoEmail();
  res.json({ ok: true });
});

function fetchSingleAccount(account) {
  return new Promise((resolve) => {
    const emails = [];
    let count = 0;
    const imap = new Imap({ user: account.user, password: account.pass, host: account.host, port: account.port || 993, tls: true, tlsOptions: { rejectUnauthorized: false } });
    imap.once('error', (err) => resolve({ count: 0, emails: [], error: err.message }));
    imap.once('end', () => {});
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) { imap.end(); return resolve({ count: 0, emails: [], error: err.message }); }
        imap.search(['UNSEEN'], (err, results) => {
          if (err) { imap.end(); return resolve({ count: 0, emails: [], error: err.message }); }
          if (!results || results.length === 0) {
            imap.search(['ALL'], (err2, all) => {
              if (err2) { imap.end(); return resolve({ count: 0, emails: [], error: err2.message }); }
              const uids = (all || []).slice(-10);
              if (!uids.length) { imap.end(); return resolve({ count: 0, emails: [] }); }
              fetchMessages(imap, uids, emails, count, resolve, account);
            });
          } else {
            const uids = results.slice(-20);
            fetchMessages(imap, uids, emails, count, resolve, account);
          }
        });
      });
    });
    imap.connect();
  });
}

function fetchMessages(imap, uids, emails, count, resolve, account) {
  const f = imap.fetch(uids, { bodies: '', markSeen: false });
  let buffer = '';
  let currentMsg = null;
  f.on('message', (msg) => {
    buffer = '';
    msg.on('body', (stream) => {
      stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
    });
    msg.once('attributes', (attrs) => {
      currentMsg = { uid: attrs.uid, flags: attrs.flags || [] };
    });
    msg.once('end', async () => {
      if (!buffer) return;
      try {
        const parsed = await simpleParser(buffer);
        const fromRaw = parsed.from?.text || parsed.from?.value?.[0]?.address || 'Unknown';
        const subject = parsed.subject || '(No subject)';
        const bodyText = parsed.text || '';
        const date = parsed.date?.toISOString() || new Date().toISOString();
        count++;
        emails.push({ id: currentMsg?.uid || count, subject, from: fromRaw, to: parsed.to?.text || '', date, text: bodyText.substring(0, 5000), seen: currentMsg?.flags?.includes('\\Seen') || false, account: account.label });
        (async () => {
          try {
            const data = await db();
            if ((data.emailLogs || []).some(e => e.subject === subject && e.fromAddr === fromRaw)) return;
            if (!data.emailLogs) data.emailLogs = [];
            const logId = uuidv4();
            const now = new Date().toISOString();
            const maskedFrom = maskEmail(fromRaw);
            data.emailLogs.push({ id: logId, fromAddr: fromRaw, fromMasked: maskedFrom, subject, body: bodyText.substring(0, 2000), receivedAt: now, processedAs: '', account: account.label });
            const ticketId = 'T' + await nextId('ticket');
            if (!data.tickets) data.tickets = [];
            data.tickets.push({ id: ticketId, subject, client: maskedFrom, status: 'Open', priority: 'Medium', description: bodyText.substring(0, 2000), category: 'Email', agent: '', createdBy: 'system', createdAt: now, updatedAt: now, rtc: '', summary: '' });
            const log = data.emailLogs.find(e => e.id === logId);
            if (log) log.processedAs = ticketId;
            await dbSave(data);
          } catch (e) {}
        })();
      } catch (e) {}
    });
  });
  f.once('error', (err) => { imap.end(); resolve({ count: 0, emails: [], error: err.message }); });
  f.once('end', () => { imap.end(); resolve({ count, emails }); });
}

async function pollAllAccounts() {
  if (pollingActive) return;
  pollingActive = true;
  try {
    const accounts = await getEmailAccounts();
    if (!accounts.length) return;
    for (const account of accounts) {
      await fetchSingleAccount(account);
    }
  } finally { pollingActive = false; }
}

function restartAutoEmail() {
  if (autoEmailTimer) { clearInterval(autoEmailTimer); autoEmailTimer = null; }
  getAutoEmailConfig().then(cfg => {
    if (cfg.enabled) {
      pollAllAccounts();
      autoEmailTimer = setInterval(pollAllAccounts, cfg.intervalMs);
      console.log(`Auto-email polling started (every ${cfg.intervalMs / 1000}s)`);
    }
  });
}

app.post('/api/fetch-emails', async (req, res) => {
  let accounts = await getEmailAccounts();
  if (req.body.accounts && Array.isArray(req.body.accounts)) {
    accounts = req.body.accounts;
  } else if (req.body.user && req.body.pass) {
    accounts = [{ id: 'inline', label: req.body.user, host: req.body.host || 'imap.gmail.com', port: parseInt(req.body.port) || 993, user: req.body.user, pass: req.body.pass }];
  }
  if (!accounts.length) {
    return res.status(400).json({ error: 'No email accounts configured' });
  }
  let total = 0;
  const fetchedEmails = [];
  const debug = [];
  for (const account of accounts) {
    const result = await fetchSingleAccount(account);
    total += result.count || 0;
    if (result.emails) fetchedEmails.push(...result.emails);
    debug.push({ account: account.label, count: result.count, emails: (result.emails||[]).length, error: result.error });
  }
  res.json({ ok: true, fetched: total, emails: fetchedEmails, debug });
});

app.get('/api/email-logs', async (req, res) => {
  const data = await db();
  res.json((data.emailLogs || []).slice(-50).reverse());
});

// ====== Legacy IMAP Config (single account, backward compat) ======
app.get('/api/imap-config', async (req, res) => {
  const accounts = await getEmailAccounts();
  const acct = accounts[0] || {};
  res.json({ host: acct.host || '', user: acct.user || '', configured: !!acct.host });
});

app.post('/api/imap-config', async (req, res) => {
  const { host, port, user, pass } = req.body;
  const accounts = await getEmailAccounts();
  const id = uuidv4();
  accounts.push({ id, label: user, host, port: port || 993, user, pass });
  await saveEmailAccounts(accounts);
  res.json({ ok: true });
});

// ====== Sync ======
app.post('/api/sync', async (req, res) => {
  const { collection, data: item } = req.body;
  const data = await db();
  if (!data[collection]) data[collection] = [];
  const idx = data[collection].findIndex(x => x.id === item.id);
  if (idx >= 0) data[collection][idx] = { ...data[collection][idx], ...item };
  else data[collection].push(item);
  await dbSave(data);
  res.json({ ok: true });
});

// ====== Catch-all ======
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next();
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message, stack: process.env.VERCEL ? undefined : err.stack });
});

if (!IS_VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pixofix Cortex server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
    restartAutoEmail();
  });
}

module.exports = app;
