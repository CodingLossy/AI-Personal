// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import { describe, expect, it } from 'vitest';
import { MAIL_PRESETS, sentCopyFolder } from './presets.js';

describe('发送后保存到「已发送」', () => {
    it('163 与 Gmail 会自动保存,不再 APPEND(避免同一 Message-ID 两份);其他服务器按账户设置', () => {
        expect(MAIL_PRESETS.find((p) => p.id === '163')?.appendToSent).toBe(false);
        // 按旧预设创建、appendToSent 仍为 true 的 163 账户
        expect(sentCopyFolder({ appendToSent: true, imap: { host: 'imap.163.com' } }, '已发送')).toBeNull();
        expect(sentCopyFolder({ appendToSent: true, imap: { host: 'IMAP.gmail.com ' } }, 'Sent')).toBeNull();
        expect(sentCopyFolder({ appendToSent: true, imap: { host: 'imap.qq.com' } }, 'Sent Messages')).toBe(
            'Sent Messages',
        );
        expect(sentCopyFolder({ appendToSent: false, imap: { host: 'imap.qq.com' } }, 'Sent')).toBeNull();
        expect(sentCopyFolder({ appendToSent: true, imap: { host: 'imap.qq.com' } }, null)).toBeNull();
    });
});
