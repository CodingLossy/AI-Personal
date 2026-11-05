// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

// 本地邮件缓存的查询与草稿(ADR 0016 第 3、6 节;M3 PR 3 的 mail.* 工具)。所有查询都按 owner 限定。
import type { MailAddress, MailAttachment, MailDraft, MailDraftAttachmentInfo, MailMessage } from '@ai-personal/shared';
import type { Connection } from './db.js';
import { newId } from './ids.js';

interface MessageRow {
    id: string;
    accountId: string;
    folderId: string;
    uid: number;
    messageId: string | null;
    inReplyTo: string | null;
    referencesJson: string;
    threadKey: string;
    fromJson: string | null;
    replyToJson: string;
    toJson: string;
    ccJson: string;
    subject: string;
    date: string;
    unread: number;
    snippet: string;
    body?: string;
}

/** 邮件与它在服务器上的位置(下载附件、回复时用)。 */
export type MailMessageRecord = MailMessage & { replyTo: MailAddress[]; folderPath: string };

export interface MailListQuery {
    accountId?: string | undefined;
    folder?: 'inbox' | 'sent' | undefined;
    unreadOnly?: boolean | undefined;
    /** 只列出这个时间及之后的邮件(ISO)。 */
    since?: string | undefined;
    limit: number;
}

export interface MailDraftCreate {
    accountId: string;
    to: string[];
    cc: string[];
    subject: string;
    text: string;
    replyToMessageId: string | null;
    attachments: MailDraftAttachmentInfo[];
}

// 一封邮件可能出现在多个文件夹中(按 Message-ID 去重):取其中一个位置
const MESSAGE_SELECT = `SELECT m.id, m.account_id AS accountId, mf.folder_id AS folderId, mf.uid,
    m.message_id AS messageId, m.in_reply_to AS inReplyTo, m.references_json AS referencesJson,
    m.thread_key AS threadKey, m.from_json AS fromJson, m.reply_to_json AS replyToJson, m.to_json AS toJson,
    m.cc_json AS ccJson, m.subject, m.date, m.unread, m.snippet, f.path AS folderPath`;
const MESSAGE_FROM = `FROM mail_messages m
    JOIN mail_accounts a ON a.id = m.account_id
    JOIN mail_message_folders mf ON mf.message_id = m.id
      AND mf.rowid = (SELECT min(x.rowid) FROM mail_message_folders x WHERE x.message_id = m.id)
    JOIN mail_folders f ON f.id = mf.folder_id`;

function ftsMatch(query: string): string | null {
    const words = query.split(/\s+/).filter((w) => [...w].length >= 3);
    return words.length ? words.map((w) => `"${w.replace(/"/g, '""')}"`).join(' OR ') : null;
}

export function createMailCacheRepository(conn: Connection, now: () => Date) {
    const { sqlite } = conn;
    const attachmentsOf = sqlite.prepare<
        [string],
        Omit<MailAttachment, 'downloaded'> & { downloaded: number; part: string }
    >(
        `SELECT id, filename, content_type AS contentType, size, downloaded, part FROM mail_attachments
         WHERE message_id = ? ORDER BY rowid`,
    );
    const q = {
        get: sqlite.prepare<[string, string], MessageRow & { folderPath: string }>(
            `${MESSAGE_SELECT}, m.body ${MESSAGE_FROM} WHERE a.owner_id = ? AND m.id = ?`,
        ),
        thread: sqlite.prepare<[string, string, string], MessageRow & { folderPath: string }>(
            `${MESSAGE_SELECT}, m.body ${MESSAGE_FROM}
             WHERE a.owner_id = ? AND m.account_id = ? AND m.thread_key = ? ORDER BY m.date LIMIT 50`,
        ),
        attachment: sqlite.prepare<
            [string, string],
            { id: string; messageId: string; part: string; filename: string; contentType: string; size: number }
        >(
            `SELECT t.id, t.message_id AS messageId, t.part, t.filename, t.content_type AS contentType, t.size
             FROM mail_attachments t JOIN mail_messages m ON m.id = t.message_id
             JOIN mail_accounts a ON a.id = m.account_id WHERE a.owner_id = ? AND t.id = ?`,
        ),
        sentFolder: sqlite.prepare<[string], { path: string }>(
            `SELECT path FROM mail_folders WHERE account_id = ? AND special_use = 'sent' LIMIT 1`,
        ),
        draftInsert: sqlite.prepare(
            `INSERT INTO mail_drafts (id, account_id, to_json, cc_json, subject, body, reply_to_message_id,
               attachments_json, created_at, updated_at)
             VALUES (@id, @accountId, @to, @cc, @subject, @text, @replyTo, @attachments, @at, @at)`,
        ),
        draftGet: sqlite.prepare<
            [string, string],
            {
                id: string;
                accountId: string;
                toJson: string;
                ccJson: string;
                subject: string;
                body: string;
                replyToMessageId: string | null;
                attachmentsJson: string;
                createdAt: string;
                updatedAt: string;
            }
        >(
            `SELECT d.id, d.account_id AS accountId, d.to_json AS toJson, d.cc_json AS ccJson, d.subject, d.body,
                    d.reply_to_message_id AS replyToMessageId, d.attachments_json AS attachmentsJson,
                    d.created_at AS createdAt, d.updated_at AS updatedAt
             FROM mail_drafts d JOIN mail_accounts a ON a.id = d.account_id WHERE a.owner_id = ? AND d.id = ?`,
        ),
        draftDelete: sqlite.prepare<[string]>('DELETE FROM mail_drafts WHERE id = ?'),
    };

    function toMessage(row: MessageRow & { folderPath: string }): MailMessageRecord {
        return {
            id: row.id,
            accountId: row.accountId,
            folderId: row.folderId,
            uid: row.uid,
            messageId: row.messageId,
            inReplyTo: row.inReplyTo,
            references: JSON.parse(row.referencesJson) as string[],
            threadKey: row.threadKey,
            from: row.fromJson ? (JSON.parse(row.fromJson) as MailAddress) : null,
            replyTo: JSON.parse(row.replyToJson) as MailAddress[],
            to: JSON.parse(row.toJson) as MailAddress[],
            cc: JSON.parse(row.ccJson) as MailAddress[],
            subject: row.subject,
            date: row.date,
            unread: row.unread === 1,
            snippet: row.snippet,
            ...(row.body !== undefined ? { text: row.body } : {}),
            attachments: attachmentsOf.all(row.id).map((a) => ({
                id: a.id,
                filename: a.filename,
                contentType: a.contentType,
                size: a.size,
                downloaded: a.downloaded === 1,
            })),
            folderPath: row.folderPath,
        };
    }

    return {
        /** 按时间倒序列出邮件(不含正文)。 */
        list(ownerId: string, query: MailListQuery): MailMessageRecord[] {
            const where = ['a.owner_id = @ownerId'];
            if (query.accountId) where.push('m.account_id = @accountId');
            if (query.folder) where.push('f.special_use = @folder');
            if (query.unreadOnly) where.push('m.unread = 1');
            if (query.since) where.push('m.date >= @since');
            const rows = sqlite
                .prepare<Record<string, unknown>, MessageRow & { folderPath: string }>(
                    `${MESSAGE_SELECT} ${MESSAGE_FROM} WHERE ${where.join(' AND ')} ORDER BY m.date DESC LIMIT @limit`,
                )
                .all({
                    ownerId,
                    accountId: query.accountId,
                    folder: query.folder,
                    since: query.since,
                    limit: query.limit,
                });
            return rows.map(toMessage);
        },
        /** 全文检索主题与正文(trigram:每个词至少 3 个字符)。 */
        search(ownerId: string, query: string, limit: number): MailMessageRecord[] {
            const match = ftsMatch(query);
            if (!match) return [];
            const rows = sqlite
                .prepare<[string, string, number], MessageRow & { folderPath: string }>(
                    `${MESSAGE_SELECT} ${MESSAGE_FROM}
                     JOIN mail_fts ON mail_fts.rowid = m.seq
                     WHERE a.owner_id = ? AND mail_fts MATCH ? ORDER BY bm25(mail_fts), m.date DESC LIMIT ?`,
                )
                .all(ownerId, match, limit);
            return rows.map(toMessage);
        },
        /** 一封邮件(含正文)。 */
        get(ownerId: string, id: string): MailMessageRecord | null {
            const row = q.get.get(ownerId, id);
            return row ? toMessage(row) : null;
        },
        /** 同一会话串的邮件(含正文),按时间先后,最多 50 封。 */
        thread(ownerId: string, accountId: string, threadKey: string): MailMessageRecord[] {
            return q.thread.all(ownerId, accountId, threadKey).map(toMessage);
        },
        attachment(ownerId: string, id: string) {
            return q.attachment.get(ownerId, id) ?? null;
        },
        /** 账户的「已发送」文件夹路径;还没同步到时为 null。 */
        sentFolder(accountId: string): string | null {
            return q.sentFolder.get(accountId)?.path ?? null;
        },
        createDraft(ownerId: string, input: MailDraftCreate): MailDraft {
            const id = newId(now());
            q.draftInsert.run({
                id,
                accountId: input.accountId,
                to: JSON.stringify(input.to),
                cc: JSON.stringify(input.cc),
                subject: input.subject,
                text: input.text,
                replyTo: input.replyToMessageId,
                attachments: JSON.stringify(input.attachments),
                at: now().toISOString(),
            });
            return this.getDraft(ownerId, id)!;
        },
        getDraft(ownerId: string, id: string): MailDraft | null {
            const row = q.draftGet.get(ownerId, id);
            if (!row) return null;
            return {
                id: row.id,
                accountId: row.accountId,
                to: JSON.parse(row.toJson) as string[],
                cc: JSON.parse(row.ccJson) as string[],
                subject: row.subject,
                text: row.body,
                replyToMessageId: row.replyToMessageId,
                attachments: JSON.parse(row.attachmentsJson) as MailDraftAttachmentInfo[],
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
            };
        },
        /** 发送成功后删除草稿。 */
        deleteDraft(id: string): void {
            q.draftDelete.run(id);
        },
    };
}
