# @waline/vercel

![Version](https://img.shields.io/npm/v/@waline/vercel?color=blue&logo=npm&style=flat-square)

This is the backend for Waline comment system.

## Installation

```
npm install @waline/vercel --save
```

## Configuration

You should set `LEAN_ID` and `LEAN_KEY` in environment variable which can get from <https://leancloud.app>.

The detail how to get `LEAN_ID` and `LEAN_KEY`: <https://waline.js.org/get-started.html>

We support [Akismet](https://akismet.com/) spam protection service default. If you want close it, please set `AKISMET_KEY` environment variable as `false`。

## Deploy

[![Deploy button](https://vercel.com/button)](https://vercel.com/import/project?template=https://github.com/walinejs/waline/tree/main/example)

Click it to deploy quickly!

## Email emoji URL rules (Seiun fork)

In **Email notifications → Emoji image URLs**, administrators can enable directory
prefix replacements for outgoing email. Rules apply only to `img.wl-emoji[src]`,
including quoted replies, private notifications, previews and template test mail.
Ordinary images, hyperlinks and stored comments are never rewritten. Already sent
emails cannot be updated.

For example, map `https://cdn.example/static/npm/@waline/emojis@1.4.0/` to
`https://cdn.jsdelivr.net/npm/@waline/emojis@1.4.0/`. Both `@` and `%40` in npm paths
are accepted. Use complete HTTP(S) directory URLs ending in `/`, without credentials,
queries or fragments. The first matching rule wins, with no chained replacements.
There are at most 20 rules; no rules are enabled by default for other installations.

Settings are saved in `dashboard-settings.json` under `mailEmojiUrls` and managed
through the administrator-only `settings?section=mail-emoji-urls` GET/PUT endpoint:

```json
{
  "enabled": true,
  "rules": [
    {
      "from": "https://cdn.example/static/npm/@waline/emojis@1.4.0/",
      "to": "https://cdn.jsdelivr.net/npm/@waline/emojis@1.4.0/"
    }
  ]
}
```

This only changes image addresses. Mail apps may still require users to allow
external images, and the replacement host must allow requests from mail clients.
