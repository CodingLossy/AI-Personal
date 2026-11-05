// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

// 邮件子进程:每次同步或连接测试启动一个,结果交回服务器后退出。imapflow、mailparser、
// nodemailer 只在这里加载,所以服务器的空闲内存不变(ADR 0016 第 2 节)。
import { describeError, syncAccount, testConnection } from './client.js';
import type { MailJob } from './run.js';

process.once('message', (job: MailJob) => {
    const work = job.kind === 'sync' ? syncAccount(job.input) : testConnection(job.imap, job.smtp);
    work.then(
        (result) => ({ ok: true as const, result }),
        (error: unknown) => ({ ok: false as const, error: describeError(error) }),
    ).then((message) => process.send!(message, () => process.exit(0)));
});
