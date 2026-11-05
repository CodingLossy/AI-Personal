// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

// 常见邮箱的默认服务器与授权码说明(开发计划 M3 第 1 条;ADR 0016 第 1 节)。
import type { MailPreset } from '@ai-personal/shared';

export const MAIL_PRESETS: readonly MailPreset[] = [
    {
        id: 'qq',
        label: 'QQ 邮箱',
        imap: { host: 'imap.qq.com', port: 993, security: 'tls' },
        smtp: { host: 'smtp.qq.com', port: 465, security: 'tls' },
        appendToSent: true,
        help: '在 QQ 邮箱网页版「设置 → 账号」中开启 IMAP/SMTP 服务并生成授权码;密码处填授权码的引用,不是 QQ 密码。',
    },
    {
        id: '163',
        label: '网易 163 邮箱',
        imap: { host: 'imap.163.com', port: 993, security: 'tls' },
        smtp: { host: 'smtp.163.com', port: 465, security: 'tls' },
        appendToSent: true,
        help: '在 163 邮箱网页版「设置 → POP3/SMTP/IMAP」中开启 IMAP/SMTP 服务并设置客户端授权码;密码处填授权码的引用。',
    },
    {
        id: 'gmail',
        label: 'Gmail',
        imap: { host: 'imap.gmail.com', port: 993, security: 'tls' },
        smtp: { host: 'smtp.gmail.com', port: 465, security: 'tls' },
        // Gmail 经 SMTP 发出的邮件会自动出现在「已发送」中,不需要再 APPEND
        appendToSent: false,
        help: '在 Google 账号中开启两步验证,然后在「应用专用密码」中生成一个密码;密码处填它的引用。不支持 OAuth 登录。',
    },
];
