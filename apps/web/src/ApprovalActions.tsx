// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import type { ToolRisk } from '@ai-personal/shared';
import { useState } from 'react';
import { api, errorText } from './api.js';
import { useI18n } from './i18n.js';

type Remember = '' | 'session' | 'always';

/** external / dangerous 工具不允许预授权(ADR 0010 第 3 节);风险未知时不提供「记住」。 */
export function canRemember(risk: ToolRisk | undefined): boolean {
    return risk === 'read' || risk === 'write';
}

/** 审批按钮:批准 / 拒绝,批准时可选「记住」(仅本次 / 本会话 / 永久)。聊天卡片与全局审批面板共用。 */
export function ApprovalActions({
    callId,
    risk,
    onDecided,
}: {
    callId: string;
    risk: ToolRisk | undefined;
    onDecided?: () => void;
}) {
    const { t } = useI18n();
    const [busy, setBusy] = useState(false);
    const [remember, setRemember] = useState<Remember>('');
    const [error, setError] = useState<string | null>(null);

    const decide = async (decision: 'approve' | 'reject') => {
        setBusy(true);
        setError(null);
        try {
            const scope = decision === 'approve' && remember ? { scope: remember } : undefined;
            await api.approvals.decide(callId, decision, scope);
            onDecided?.();
        } catch (e) {
            setError(errorText(e));
            setBusy(false);
        }
    };

    return (
        <div className="approval">
            <span className="small">{t('tool.approvalNeeded')}</span>
            {risk ? <span className={`badge risk-${risk}`}>{t(`risk.${risk}`)}</span> : null}
            {canRemember(risk) ? (
                <select
                    aria-label={t('tool.remember')}
                    value={remember}
                    onChange={(e) => setRemember(e.target.value as Remember)}
                    disabled={busy}
                >
                    <option value="">{t('tool.rememberOnce')}</option>
                    <option value="session">{t('tool.rememberSession')}</option>
                    <option value="always">{t('tool.rememberAlways')}</option>
                </select>
            ) : null}
            <button type="button" className="primary" disabled={busy} onClick={() => void decide('approve')}>
                {t('tool.approve')}
            </button>
            <button type="button" className="danger" disabled={busy} onClick={() => void decide('reject')}>
                {t('tool.reject')}
            </button>
            {error ? <p className="error small">{error}</p> : null}
        </div>
    );
}
