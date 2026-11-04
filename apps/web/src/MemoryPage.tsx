// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import type { Memory } from '@ai-personal/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, errorText } from './api.js';
import { useI18n } from './i18n.js';

function MemoryItem({ memory, onChanged }: { memory: Memory; onChanged: () => Promise<void> }) {
    const { t, locale } = useI18n();
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState(memory.text);
    const [error, setError] = useState<string | null>(null);

    const save = async (e: FormEvent) => {
        e.preventDefault();
        try {
            await api.memory.update(memory.id, { text });
            setEditing(false);
            await onChanged();
        } catch (err) {
            setError(errorText(err));
        }
    };

    const remove = async () => {
        if (!window.confirm(t('memory.deleteConfirm'))) return;
        try {
            await api.memory.delete(memory.id);
            await onChanged();
        } catch (err) {
            setError(errorText(err));
        }
    };

    return (
        <li className="card memory" data-memory-id={memory.id}>
            {editing ? (
                <form className="row" onSubmit={save}>
                    <input
                        aria-label={t('memory.edit')}
                        value={text}
                        minLength={2}
                        maxLength={200}
                        onChange={(e) => setText(e.target.value)}
                    />
                    <button type="submit" className="primary">
                        {t('memory.save')}
                    </button>
                    <button type="button" onClick={() => setEditing(false)}>
                        {t('memory.cancel')}
                    </button>
                </form>
            ) : (
                <p className="memory-text">{memory.text}</p>
            )}
            <div className="small muted">
                {t('memory.type')}: {memory.memType}
                {memory.subtype ? `/${memory.subtype}` : ''} · {t('memory.domain')}: {memory.domain} ·{' '}
                {t('memory.origin')}: {memory.origin} · {t('memory.status')}: {memory.status} · {t('memory.confidence')}
                : {memory.confidence.toFixed(2)} · {t('memory.updated')}:{' '}
                {new Date(memory.updatedAt).toLocaleString(locale)}
            </div>
            {editing ? null : (
                <div className="row">
                    <button type="button" onClick={() => setEditing(true)}>
                        {t('memory.edit')}
                    </button>
                    <button type="button" className="danger" onClick={() => void remove()}>
                        {t('memory.delete')}
                    </button>
                </div>
            )}
            {error ? <p className="error small">{error}</p> : null}
        </li>
    );
}

export function MemoryPage() {
    const { t } = useI18n();
    const [items, setItems] = useState<Memory[] | null>(null);
    const [query, setQuery] = useState('');
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        try {
            const q = query.trim();
            setItems(
                q
                    ? (await api.memory.search({ query: q, limit: 30 })).items
                    : (await api.memory.list({ limit: 200 })).items,
            );
            setError(null);
        } catch (e) {
            setError(errorText(e));
        }
    }, [query]);

    useEffect(() => {
        const timer = setTimeout(() => void reload(), 200);
        return () => clearTimeout(timer);
    }, [reload]);

    return (
        <div className="page">
            <h1>{t('memory.title')}</h1>
            <input
                type="search"
                className="search"
                aria-label={t('memory.search')}
                placeholder={t('memory.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
            />
            {error ? <p className="error">{error}</p> : null}
            {items === null ? <p className="muted">{t('common.loading')}</p> : null}
            {items?.length === 0 ? <p className="muted">{t('memory.empty')}</p> : null}
            <ul className="list">
                {items?.map((m) => (
                    <MemoryItem key={`${m.id}:${m.updatedAt}`} memory={m} onChanged={reload} />
                ))}
            </ul>
        </div>
    );
}
