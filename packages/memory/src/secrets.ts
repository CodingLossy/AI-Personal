// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

// 凭据拒存的最小规则集(《记忆模块补充设计》第 3 节;完整规则与语料测试在 M2)。
// 规则由本项目自行编写;只在本地判断,不外传任何内容。

export type CredentialKind =
    'api_key' | 'access_token' | 'jwt' | 'private_key' | 'password_assignment' | 'high_entropy';

const PATTERNS: readonly [CredentialKind, RegExp][] = [
    ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['api_key', /\bsk-[A-Za-z0-9_-]{16,}/],
    ['api_key', /\bAIza[A-Za-z0-9_-]{30,}/],
    ['api_key', /\bAKIA[A-Z0-9]{16}\b/],
    ['access_token', /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|aip_pat_[A-Za-z0-9_-]{20,})/],
    ['access_token', /\bxox[abpsr]-[A-Za-z0-9-]{10,}/],
    ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
    // 「密码是 xxx」「password: xxx」「token=xxx」这类赋值
    [
        'password_assignment',
        /(password|passwd|pwd|passcode|token|secret|api[\s_-]?key|密码|口令|密钥|验证码)\s*(?:is|=|:|：|是|为)\s*\S{4,}/i,
    ],
];

/** 香农熵(比特 / 字符)。 */
function entropy(s: string): number {
    const counts = new Map<string, number>();
    for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    let h = 0;
    for (const n of counts.values()) {
        const p = n / s.length;
        h -= p * Math.log2(p);
    }
    return h;
}

/** 长度 ≥ 20、同时含字母与数字、熵 ≥ 4.0 的连续串视为疑似密钥。 */
function hasHighEntropyToken(text: string): boolean {
    for (const token of text.split(/[\s"'`,;:()[\]{}<>，。；：（）]+/)) {
        if (token.length >= 20 && /[A-Za-z]/.test(token) && /\d/.test(token) && entropy(token) >= 4.0) return true;
    }
    return false;
}

/** 返回检测到的凭据类型;未检测到时返回 null。 */
export function detectCredential(text: string): CredentialKind | null {
    for (const [kind, pattern] of PATTERNS) if (pattern.test(text)) return kind;
    return hasHighEntropyToken(text) ? 'high_entropy' : null;
}
