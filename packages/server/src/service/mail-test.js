const nodemailer = require('nodemailer');
const smtp = require('./smtp-settings.js');
const templates = require('./mail-templates.js');

let busy = false;
let lastAttempt = 0;
const send = async (value) => {
  const to = typeof value?.to === 'string' ? value.to.trim() : '';
  if (to.length > 320 || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/u.test(to)) {
    return { sent: false, reason: 'recipient' };
  }
  let message;
  if (value.template) {
    try {
      const rendered = templates.preview(value.template);
      message = { subject: `[Waline Test] ${rendered.subject}`, html: rendered.body };
    } catch {
      return { sent: false, reason: 'template' };
    }
  } else {
    message = { subject: 'Waline SMTP test', text: 'This is a test email from Waline. No reply is required.' };
  }
  const config = smtp.transport();
  if (!config) return { sent: false, reason: 'disabled' };
  if (busy || Date.now() - lastAttempt < 30000) return { sent: false, reason: 'rate' };
  busy = true;
  lastAttempt = Date.now();
  let transport;
  try {
    transport = nodemailer.createTransport({ ...config, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
    const result = await transport.sendMail({ from: smtp.from(), to, ...message });
    return result.accepted?.some(address => address.toLowerCase() === to.toLowerCase())
      ? { sent: true } : { sent: false, reason: 'rejected' };
  } catch (err) {
    const reason = err.code === 'EAUTH' ? 'auth'
      : ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS'].includes(err.code) ? 'connection'
        : err.code === 'EENVELOPE' ? 'rejected' : 'failed';
    return { sent: false, reason };
  } finally {
    transport?.close();
    busy = false;
  }
};
module.exports = { send };
