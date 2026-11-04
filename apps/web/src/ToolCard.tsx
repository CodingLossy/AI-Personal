// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import { ApprovalActions } from './ApprovalActions.js';
import { useI18n } from './i18n.js';
import type { LiveTool } from './live-turn.js';

export function show(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/**
 * 工具调用卡片;等待审批时显示「批准」「拒绝」与「记住」选项(ADR 0009 第 4 节、ADR 0010 第 3 节)。
 * 摘要与入参来自模型,一律按纯文本显示。
 */
export function ToolCard({ tool, live = false }: { tool: LiveTool; live?: boolean }) {
    const { t } = useI18n();
    const pending = live && tool.approval && !tool.approval.decision;
    const resolved = tool.approval?.decision;

    return (
        <div className={`tool-card${pending ? ' pending' : ''}`} data-call-id={tool.callId}>
            <div className="tool-title">{t('tool.call', { name: tool.name })}</div>
            {tool.approval ? <p className="tool-summary">{tool.approval.summary}</p> : null}
            <details>
                <summary className="small muted">input</summary>
                <pre>{show(tool.input)}</pre>
            </details>
            {pending ? (
                <ApprovalActions callId={tool.callId} risk={tool.approval?.risk} />
            ) : resolved ? (
                <p className="small decision">
                    {tool.approval?.reason === 'expired'
                        ? t('tool.expired')
                        : resolved === 'approve'
                          ? t('tool.approved')
                          : t('tool.rejected')}
                </p>
            ) : null}
            {tool.result ? (
                tool.result.error ? (
                    <p className="error small">{t('tool.error', { msg: tool.result.error })}</p>
                ) : (
                    <details>
                        <summary className="small muted">{t('tool.result')}</summary>
                        <pre>{show(tool.result.output)}</pre>
                    </details>
                )
            ) : null}
        </div>
    );
}
