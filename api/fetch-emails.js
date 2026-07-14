const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { host, port, user, pass, since } = req.body;

  if (!host || !user || !pass) {
    return res.status(400).json({
      error: 'IMAP credentials required',
      hint: 'Pass { host, port, user, pass } in the request body'
    });
  }

  try {
    const client = new ImapFlow({
      host,
      port: port || 993,
      secure: true,
      auth: { user, pass },
      logger: false,
      tls: { rejectUnauthorized: false }
    });

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    const emails = [];
    try {
      const fetchOpts = { envelope: true, source: true, flags: true };
      for await (const msg of client.fetch('1:20', fetchOpts)) {
        try {
          const parsed = await simpleParser(msg.source);
          emails.push({
            id: msg.uid,
            subject: parsed.subject || '(No subject)',
            from: parsed.from?.text || 'Unknown',
            to: parsed.to?.text || '',
            date: parsed.date?.toISOString() || new Date().toISOString(),
            text: (parsed.text || '').substring(0, 5000),
            html: (parsed.html || '').substring(0, 1000),
            seen: msg.flags?.includes('\\Seen') || false
          });
        } catch (parseErr) {
          emails.push({
            id: msg.uid,
            subject: '(Parse error)',
            from: 'Unknown',
            date: new Date().toISOString(),
            text: 'Failed to parse email content'
          });
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();

    res.json({
      ok: true,
      count: emails.length,
      emails
    });
  } catch (err) {
    console.error('IMAP fetch error:', err);
    res.status(500).json({
      error: err.message,
      hint: 'Check IMAP credentials. For Gmail: use an App Password if 2FA is enabled.'
    });
  }
};
