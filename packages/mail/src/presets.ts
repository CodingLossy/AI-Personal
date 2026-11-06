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
        // 163 经 SMTP 发出的邮件会自动保存到「已发送」;再 APPEND 会多出一份(同一 Message-ID 两个 UID)
        appendToSent: false,
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

/** 经 SMTP 发信后会自动把邮件存进「已发送」的 IMAP 服务器;对它们 APPEND 只会产生重复。 */
const SERVERS_THAT_SAVE_SENT = new Set(['imap.163.com', 'imap.gmail.com']);

/**
 * 发送成功后要 APPEND 到的文件夹;不需要时为 null。
 * 账户的 `appendToSent` 为 true 但服务器本来就会自动保存时也不 APPEND,
 * 这样按旧预设创建的 163 账户不会再产生重复。
 */
export function sentCopyFolder(
    account: { appendToSent: boolean; imap: { host: string } },
    sentFolder: string | null,
): string | null {
    if (!account.appendToSent || !sentFolder) return null;
    return SERVERS_THAT_SAVE_SENT.has(account.imap.host.trim().toLowerCase()) ? null : sentFolder;
}
