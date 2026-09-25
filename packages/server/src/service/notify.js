const crypto = require('node:crypto');

const FormData = require('form-data');
const nodemailer = require('nodemailer');
const nunjucks = require('nunjucks');
const mailTemplates = require('./mail-templates.js');
const dashboardSettings = require('./dashboard-settings.js');
const smtpSettings = require('./smtp-settings.js');
const mailEmojiUrls = require('./mail-emoji-urls.js');
const { active, same, canRead, isPrivate } = require('./comment-privacy.js');

module.exports = class NotifyService extends think.Service {
  constructor(controller) {
    super(controller);

    this.controller = controller;
    const config = smtpSettings.transport();
    if (config) this.transporter = nodemailer.createTransport(config);
  }

  async sleep(second) {
    return new Promise((resolve) => {
      setTimeout(resolve, second * 1000);
    });
  }

  async mail({ to, title, content, templateKind }, self, parent) {
    if (!this.transporter) {
      return;
    }

    const { SITE_NAME, SITE_URL } = process.env;
    const data = {
      self,
      parent,
      site: {
        name: SITE_NAME,
        url: SITE_URL,
        postUrl: `${SITE_URL}${self.url}#${self.objectId}`,
      },
    };

    const lang = mailTemplates.language(this.controller.get('lang'));
    const custom = templateKind && dashboardSettings.read().mail?.[lang]?.[templateKind];
    if (custom) {
      const rendered = mailTemplates.render(custom, data);
      title = rendered.subject;
      content = rendered.body;
    } else {
      title = this.controller.locale(title, data);
      content = this.controller.locale(content, data);
    }

    if (isPrivate(self)) {
      const chinese = lang.startsWith('zh');
      const label = chinese ? '私密评论' : 'Private comment';
      const notice = chinese
        ? '仅对话双方及管理员可见，请勿转发邮件内容。'
        : 'Visible only to the participants and administrators. Please do not forward.';
      title = `[${label}] ${title}`;
      const badge = `<div role="note" style="max-width:600px;margin:16px auto;padding:12px 16px;border:1px solid #b9c4e8;border-radius:12px;color:#6265a8;background:#f2ecfa;font:14px/1.6 sans-serif"><strong>${label}</strong> · ${notice}</div>`;
      content = /<body\b[^>]*>/iu.test(content)
        ? content.replace(/<body\b[^>]*>/iu, (opening) => opening + badge)
        : badge + content;
    }

    return this.transporter.sendMail({
      from: smtpSettings.from(),
      to,
      subject: title,
      html: mailEmojiUrls.rewrite(content),
    });
  }

  async wechat({ title, content }, self, parent) {
    const { SC_KEY, SITE_NAME, SITE_URL } = process.env;

    if (!SC_KEY) {
      return false;
    }

    const data = {
      self,
      parent,
      site: {
        name: SITE_NAME,
        url: SITE_URL,
        postUrl: `${SITE_URL}${self.url}#${self.objectId}`,
      },
    };

    const contentWechat =
      think.config('SCTemplate') ||
      `{{site.name|safe}} 有新评论啦
【评论者昵称】：{{self.nick}}
【评论者邮箱】：{{self.mail}} 
【内容】：{{self.comment}}
【地址】：{{site.postUrl}}`;

    title = this.controller.locale(title, data);
    content = this.controller.locale(contentWechat, data);

    const form = new FormData();

    form.append('text', title);
    form.append('desp', content);

    return fetch(`https://sctapi.ftqq.com/${SC_KEY}.send`, {
      method: 'POST',
      headers: form.getHeaders(),
      body: form,
    }).then((resp) => resp.json());
  }

  async qywxAmWechat({ title, content }, self, parent) {
    const { QYWX_AM, QYWX_PROXY, QYWX_PROXY_PORT, SITE_NAME, SITE_URL } = process.env;

    if (!QYWX_AM) {
      return false;
    }

    const QYWX_AM_AY = QYWX_AM.split(',');
    const comment = self.comment
      .replaceAll(/<a href="(?<url>.*?)">(?<text>.*?)<\/a>/gu, '\n[$2] $1\n')
      .replaceAll(/<[^>]+>/gu, '');
    const postName = self.url;

    const data = {
      self: {
        ...self,
        comment,
      },
      postName,
      parent,
      site: {
        name: SITE_NAME,
        url: SITE_URL,
        postUrl: `${SITE_URL}${self.url}#${self.objectId}`,
      },
    };

    const contentWechat =
      think.config('WXTemplate') ||
      `💬 {{site.name|safe}}的文章《{{postName}}》有新评论啦 
【评论者昵称】：{{self.nick}}
【评论者邮箱】：{{self.mail}} 
【内容】：{{self.comment}} 
<a href='{{site.postUrl}}'>查看详情</a>`;

    title = this.controller.locale(title, data);
    const desp = this.controller.locale(contentWechat, data);

    content = desp.replaceAll('\n', '<br/>');

    const querystring = new URLSearchParams();

    querystring.set('corpid', `${QYWX_AM_AY[0]}`);
    querystring.set('corpsecret', `${QYWX_AM_AY[1]}`);

    let baseUrl = 'https://qyapi.weixin.qq.com';

    if (QYWX_PROXY) {
      baseUrl = `http://${QYWX_PROXY}${QYWX_PROXY_PORT ? `:${QYWX_PROXY_PORT}` : ''}`;
    }

    const { access_token } = await fetch(`${baseUrl}/cgi-bin/gettoken?${querystring.toString()}`, {
      headers: {
        'content-type': 'application/json',
      },
    }).then((resp) => resp.json());

    return fetch(`${baseUrl}/cgi-bin/message/send?access_token=${access_token}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        touser: `${QYWX_AM_AY[2]}`,
        agentid: `${QYWX_AM_AY[3]}`,
        msgtype: 'mpnews',
        mpnews: {
          articles: [
            {
              title,
              thumb_media_id: `${QYWX_AM_AY[4]}`,
              author: `Waline Comment`,
              content_source_url: `${data.site.postUrl}`,
              content: `${content}`,
              digest: `${desp}`,
            },
          ],
        },
      }),
    }).then((resp) => resp.json());
  }

  async qq(self, parent) {
    const { QMSG_KEY, QQ_ID, SITE_NAME, SITE_URL, QMSG_HOST } = process.env;

    if (!QMSG_KEY) {
      return false;
    }

    const comment = self.comment
      .replaceAll(/<a href="(?:.*?)">(?:.*?)<\/a>/gu, '')
      .replaceAll(/<[^>]+>/gu, '');

    const data = {
      self: {
        ...self,
        comment,
      },
      parent,
      site: {
        name: SITE_NAME,
        url: SITE_URL,
        postUrl: `${SITE_URL}${self.url}#${self.objectId}`,
      },
    };

    const contentQQ =
      think.config('QQTemplate') ||
      `💬 {{site.name|safe}} 有新评论啦
{{self.nick}} 评论道：
{{self.comment}}
仅供预览评论，请前往上述页面查看完整內容。`;

    const qmsgHost = QMSG_HOST ? QMSG_HOST.replace(/\/$/u, '') : 'https://qmsg.zendee.cn';

    const postBodyData = {
      qq: QQ_ID,
      msg: this.controller.locale(contentQQ, data),
    };
    const postBody = Object.keys(postBodyData)
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(postBodyData[key])}`)
      .join('&');

    return fetch(`${qmsgHost}/send/${QMSG_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: postBody,
    }).then((resp) =>
      resp.json().then((json) => {
        think.logger.debug(`qq notify response: ${JSON.stringify(json)}`);

        return json;
      }),
    );
  }

  async telegram(self, parent) {
    const { TG_BOT_TOKEN, TG_CHAT_ID, SITE_NAME, SITE_URL } = process.env;

    if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
      return false;
    }

    let commentLink = '';
    const href = self.comment.match(/<a href="(?:.*?)">(?:.*?)<\/a>/gu);

    if (href != null) {
      for (let i = 0; i < href.length; i++) {
        href[i] =
          `[Link: ${href[i].replaceAll(/<a href="(?<url>.*?)">(?<text>.*?)<\/a>/gu, '$2')}](${href[i].replaceAll(/<a href="(?<url>.*?)">(?<text>.*?)<\/a>/gu, '$1')})  `;
        commentLink += href[i];
      }
    }
    if (commentLink !== '') {
      commentLink = `\n${commentLink}\n`;
    }

    const comment = self.comment
      .replaceAll(/<a href="(?<url>.*?)">(?<text>.*?)<\/a>/gu, '[Link:$2]')
      .replaceAll(/<[^>]+>/gu, '');

    const contentTG =
      think.config('TGTemplate') ||
      `💬 *[{{site.name}}]({{site.url}}) 有新评论啦*

*{{self.nick}}* 回复说：

\`\`\`
{{self.comment-}}
\`\`\`
{{-self.commentLink}}
*邮箱：*\`{{self.mail}}\`
*审核：*{{self.status}}

仅供评论预览，点击[查看完整內容]({{site.postUrl}})`;

    const data = {
      self: {
        ...self,
        comment,
        commentLink,
      },
      parent,
      site: {
        name: SITE_NAME,
        url: SITE_URL,
        postUrl: `${SITE_URL}${self.url}#${self.objectId}`,
      },
    };

    const resp = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text: this.controller.locale(contentTG, data),
        parse_mode: 'MarkdownV2',
      }),
    }).then((resp) => resp.json());

    if (!resp.ok) {
      console.log(`Telegram Notification Failed:${JSON.stringify(resp)}`);
    }
  }

  async pushplus({ title, content }, self, parent) {
    const {
      PUSH_PLUS_KEY,
      PUSH_PLUS_TOPIC: topic,
      PUSH_PLUS_TEMPLATE: template,
      PUSH_PLUS_CHANNEL: channel,
      PUSH_PLUS_WEBHOOK: webhook,
      PUSH_PLUS_CALLBACKURL: callbackUrl,
      SITE_NAME,
      SITE_URL,
    } = process.env;

    if (!PUSH_PLUS_KEY) {
      return false;
    }

    const data = {
      self,
      parent,
      site: {
        name: SITE_NAME,
        url: SITE_URL,
        postUrl: `${SITE_URL}${self.url}#${self.objectId}`,
      },
    };

    title = this.controller.locale(title, data);
    content = this.controller.locale(content, data);

    const form = new URLSearchParams();

    if (topic) {
      form.set('topic', topic);
    }
    if (template) {
      form.set('template', template);
    }
    if (channel) {
      form.set('channel', channel);
    }
    if (webhook) {
      form.set('webhook', webhook);
    }
    if (callbackUrl) {
      form.set('callbackUrl', callbackUrl);
    }
    if (title) {
      form.set('title', title);
    }
    if (content) {
      form.set('content', content);
    }

    return fetch(`http://www.pushplus.plus/send/${PUSH_PLUS_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    }).then((resp) => resp.json());
  }

  async discord({ title, content }, self, parent) {
    const { DISCORD_WEBHOOK, SITE_NAME, SITE_URL } = process.env;

    if (!DISCORD_WEBHOOK) {
      return false;
    }

    const data = {
      self,
      parent,
      site: {
        name: SITE_NAME,
        url: SITE_URL,
        postUrl: `${SITE_URL}${self.url}#${self.objectId}`,
      },
    };

    title = this.controller.locale(title, data);
    content = this.controller.locale(
      think.config('DiscordTemplate') ||
        `💬 {{site.name|safe}} 有新评论啦 
    【评论者昵称】：{{self.nick}}
    【评论者邮箱】：{{self.mail}} 
    【内容】：{{self.comment}} 
    【地址】：{{site.postUrl}}`,
      data,
    );

    return fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: `${title}\n${content}`,
      }),
    }).then((resp) => resp.statusText);
    // Expected return value: No Content
    // Since Discord doesn't return any response body on success, we just return the status text.
  }

  async lark({ title, content }, self, parent) {
    const { LARK_WEBHOOK, LARK_SECRET, SITE_NAME, SITE_URL } = process.env;

    if (!LARK_WEBHOOK) {
      return false;
    }

    self.comment = self.comment.replaceAll(/(?:<[^>]+>)/giu, '');

    const data = {
      self,
      parent,
      site: {
        name: SITE_NAME,
        url: SITE_URL,
        postUrl: `${SITE_URL}${self.url}#${self.objectId}`,
      },
    };

    content = nunjucks.renderString(
      think.config('LarkTemplate') ||
        `【网站名称】：{{site.name|safe}} \n【评论者昵称】：{{self.nick}}\n【评论者邮箱】：{{self.mail}}\n【内容】：{{self.comment}}【地址】：{{site.postUrl}}`,
      data,
    );

    const post = {
      en_us: {
        title: this.controller.locale(title, data),
        content: [
          [
            {
              tag: 'text',
              text: content,
            },
          ],
        ],
      },
    };

    let signData = {};
    const msg = {
      msg_type: 'post',
      content: {
        post,
      },
    };

    const sign = (timestamp, secret) => {
      const signStr = `${timestamp}\n${secret}`;

      return crypto.createHmac('sha256', signStr).update('').digest('base64');
    };

    if (LARK_SECRET) {
      const timestamp = Math.trunc(Number(Date.now() / 1000));

      signData = { timestamp, sign: sign(timestamp, LARK_SECRET) };
    }

    const resp = await fetch(LARK_WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...signData,
        ...msg,
      }),
    }).then((resp) => resp.json());

    if (resp.status !== 200) {
      console.log(`Lark Notification Failed:${JSON.stringify(resp)}`);
    }

    console.log(`FeiShu Notification Success:${JSON.stringify(resp)}`);
  }

  realEmail(email) {
    if (typeof email !== 'string' || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(email)) return false;
    // OAuth placeholder addresses are not deliverable mailboxes.
    const domain = email.split('@')[1].toLowerCase();
    return (
      !/^mail\.[^.]+$/u.test(domain) &&
      !(this.controller.ctx.state.oauthServices || []).some(
        ({ name }) => domain === `mail.${name}`.toLowerCase(),
      )
    );
  }

  async privateMail(comment, parent) {
    if (!isPrivate(comment) || comment.status !== 'approved') return;
    const ids = [comment.private_user_a, comment.private_user_b];
    if (ids.some((id) => id == null) || same(...ids)) return;
    if (!ids.some((id) => same(id, comment.user_id))) return;
    const accounts = await this.controller.getModel('Users').select({ objectId: ['IN', ids] });
    const sender = accounts.find((user) => same(user.objectId, comment.user_id));
    const recipient = accounts.find(
      (user) => ids.some((id) => same(id, user.objectId)) && !same(user.objectId, comment.user_id),
    );
    if (!active(sender) || !active(recipient)) return;
    // Account IDs still authorize the conversation. For an administrator,
    // deliver to the same configured inbox used by public owner notifications.
    const to =
      recipient.type === 'administrator'
        ? smtpSettings.read().authorEmail || recipient.email
        : recipient.email;
    if (!this.realEmail(to)) return;
    // Do not quote a parent whose audience has changed or cannot be verified.
    if (
      parent &&
      (!canRead(recipient, parent) ||
        (parent.status !== 'approved' &&
          recipient.type !== 'administrator' &&
          !same(parent.user_id, recipient.objectId)))
    ) {
      return;
    }
    const config = think.config();
    await this.mail(
      {
        to,
        templateKind: parent ? 'reply' : 'admin',
        title: parent
          ? config.mailSubject || 'MAIL_SUBJECT'
          : config.mailSubjectAdmin || 'MAIL_SUBJECT_ADMIN',
        content: parent
          ? config.mailTemplate || 'MAIL_TEMPLATE'
          : config.mailTemplateAdmin || 'MAIL_TEMPLATE_ADMIN',
      },
      comment,
      parent,
    );
  }

  async run(comment, parent, disableAuthorNotify = false) {
    // Private mail is account-addressed and never reaches third-party relays.
    if (isPrivate(comment) || isPrivate(parent)) {
      try {
        await this.privateMail(comment, parent);
      } catch {
        console.error('Private notification failed');
      }
      return;
    }
    const { DISABLE_AUTHOR_NOTIFY } = process.env;
    const AUTHOR_EMAIL = smtpSettings.read().authorEmail;
    const { mailSubject, mailTemplate, mailSubjectAdmin, mailTemplateAdmin } = think.config();
    const mailList = [];
    const isAdminComment = comment.type === 'administrator';
    const isReplyAdmin = parent?.type === 'administrator';
    const isCommentSelf =
      parent &&
      (parent.user_id && comment.user_id
        ? parent.user_id === comment.user_id
        : (parent.mail || '').toLowerCase() === (comment.mail || '').toLowerCase());

    const title = mailSubjectAdmin || 'MAIL_SUBJECT_ADMIN';
    const content = mailTemplateAdmin || 'MAIL_TEMPLATE_ADMIN';

    if (!DISABLE_AUTHOR_NOTIFY && !isAdminComment && !disableAuthorNotify) {
      await this.wechat({ title, content }, comment, parent);
      await this.qywxAmWechat({ title, content }, comment, parent);
      await this.qq(comment, parent);
      await this.telegram(comment, parent);
      await this.pushplus({ title, content }, comment, parent);
      await this.discord({ title, content }, comment, parent);
      await this.lark({ title, content }, comment, parent);
    }

    if (
      smtpSettings.read().authorNotify &&
      !isAdminComment &&
      !disableAuthorNotify &&
      this.realEmail(AUTHOR_EMAIL)
    ) {
      mailList.push({ to: AUTHOR_EMAIL, title, content, templateKind: 'admin' });
    }

    const disallowList = this.controller.ctx.state.oauthServices.map(({ name }) => `mail.${name}`);
    const fakeMail = new RegExp(`@(${disallowList.join('|')})$`, 'iu');

    if (
      parent &&
      !fakeMail.test(parent.mail) &&
      !isCommentSelf &&
      !isReplyAdmin &&
      comment.status !== 'waiting'
    ) {
      mailList.push({
        to: parent.mail,
        templateKind: 'reply',
        title: mailSubject || 'MAIL_SUBJECT',
        content: mailTemplate || 'MAIL_TEMPLATE',
      });
    }

    for (const mail of mailList) {
      if (mailList.find((item) => item.to?.toLowerCase() === mail.to?.toLowerCase()) !== mail) {
        continue;
      }
      try {
        const response = await this.mail(mail, comment, parent);

        console.log('Notification mail send success: %s', response);
      } catch (err) {
        console.log('Mail send fail:', err);
      }
    }
  }
};
