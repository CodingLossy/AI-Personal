// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import { useState } from 'react';
import { api, errorText } from './api.js';
import { useI18n } from './i18n.js';
import type { LiveTool } from './live-turn.js';

function show(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** 工具调用卡片;等待审批时只有「批准」「拒绝」两个按钮(ADR 0009 第 4 节)。 */
export function ToolCard({ tool, live = false }: { tool: LiveTool; live?: boolean }) {
    const { t } = useI18n();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pending = live && tool.approval && !tool.approval.decision;

    const decide = async (decision: 'approve' | 'reject') => {
        setBusy(true);
        setError(null);
        try {
            await api.approvals.decide(tool.callId, decision);
        } catch (e) {
            setError(errorText(e));
            setBusy(false);
        }
    };

    return (
        <div className={`tool-card${pending ? ' pending' : ''}`} data-call-id={tool.callId}>
            <div className="tool-title">{t('tool.call', { name: tool.name })}</div>
            {tool.approval ? <p className="tool-summary">{tool.approval.summary}</p> : null}
            <details>
                <summary className="small muted">input</summary>
                <pre>{show(tool.input)}</pre>
            </details>
            {pending ? (
                <div className="approval">
                    <span className="small">{t('tool.approvalNeeded')}</span>
                    <button type="button" className="primary" disabled={busy} onClick={() => void decide('approve')}>
                        {t('tool.approve')}
                    </button>
                    <button type="button" className="danger" disabled={busy} onClick={() => void decide('reject')}>
                        {t('tool.reject')}
                    </button>
                </div>
            ) : tool.approval?.decision ? (
                <p className="small decision">
                    {tool.approval.decision === 'approve' ? t('tool.approved') : t('tool.rejected')}
                </p>
            ) : null}
            {error ? <p className="error small">{error}</p> : null}
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
