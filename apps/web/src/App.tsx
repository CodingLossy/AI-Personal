// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import type { MetaResponse } from '@ai-personal/shared';
import { useEffect, useState } from 'react';
import { Footer } from './Footer.js';

export function App() {
    const [meta, setMeta] = useState<MetaResponse | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        fetch('/api/v1/meta', { signal: controller.signal })
            .then((res) => (res.ok ? (res.json() as Promise<MetaResponse>) : null))
            .then(setMeta)
            .catch(() => setMeta(null));
        return () => controller.abort();
    }, []);

    return (
        <div className="layout">
            <main>
                <h1>AI-Personal</h1>
                <p>一个真正属于你自己的 AI 助手。</p>
            </main>
            <Footer meta={meta} />
        </div>
    );
}
