/**
 * ChatGPT Subscription (OAuth) client.
 *
 * Uses the operator's ChatGPT monthly subscription via the Codex-style OAuth
 * tokens in ~/.codex/auth.json. Talks to the subscription backend
 * (chatgpt.com/backend-api/codex/responses — the Responses API surface shared
 * by Codex CLI/IDE/app). Supports streaming text, vision (input_image), and
 * function tool calling.
 *
 * Credential handling:
 * - The single durable token store is the auth file (default ~/.codex/auth.json).
 * - Access tokens are refreshed with the stored refresh_token against
 *   auth.openai.com and written back to the auth file, exactly like Codex CLI,
 *   so both consumers share one token lineage.
 * - Raw tokens never leave this module; callers get responses, not secrets.
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
// Public client id used by Codex CLI's OAuth app (not a secret).
const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const BACKEND_URL = 'https://chatgpt.com/backend-api/codex/responses';
// FLOYD vault proxy: when the frame injects these, the loopback credential
// proxy owns the Codex OAuth tokens and this client sends only its fv_ token.
const VAULT_PROXY_URL = process.env.FLOYD_VAULT_PROXY_URL;
const VAULT_PROXY_TOKEN = process.env.FLOYD_VAULT_PROXY_TOKEN;
const USE_VAULT_PROXY = Boolean(VAULT_PROXY_URL && VAULT_PROXY_TOKEN);
export const CHATGPT_AUTH_FILE_DEFAULT = path.join(os.homedir(), '.codex', 'auth.json');
export const CHATGPT_MODELS = [
    { id: 'gpt-5.5', name: 'GPT-5.5 (Most Capable)' },
    { id: 'gpt-5.4', name: 'GPT-5.4 (Balanced)' },
    { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini (Fast)' },
    { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex (Coding)' },
];
function decodeJwtExp(token) {
    try {
        const payload = token.split('.')[1];
        const pad = payload + '='.repeat((4 - (payload.length % 4)) % 4);
        const claims = JSON.parse(Buffer.from(pad, 'base64url').toString());
        return typeof claims.exp === 'number' ? claims.exp : null;
    }
    catch {
        return null;
    }
}
export class ChatGPTSubscriptionClient {
    authFile;
    refreshing = null;
    constructor(authFile) {
        this.authFile = authFile || process.env.CHATGPT_AUTH_FILE || CHATGPT_AUTH_FILE_DEFAULT;
    }
    getAuthFilePath() {
        return this.authFile;
    }
    async isConfigured() {
        if (USE_VAULT_PROXY) {
            try {
                const res = await fetch(`${VAULT_PROXY_URL}/healthz`, { signal: AbortSignal.timeout(2000) });
                return res.ok;
            }
            catch {
                return false;
            }
        }
        try {
            const auth = await this.readAuth();
            return Boolean(auth.tokens?.access_token && auth.tokens?.refresh_token);
        }
        catch {
            return false;
        }
    }
    /** Non-secret status for health/settings endpoints. */
    async status() {
        try {
            const auth = await this.readAuth();
            const exp = decodeJwtExp(auth.tokens.access_token);
            return {
                configured: true,
                accountId: auth.tokens.account_id,
                expiresAt: exp ?? undefined,
                authFile: this.authFile,
            };
        }
        catch {
            return { configured: false, authFile: this.authFile };
        }
    }
    async readAuth() {
        const raw = await fs.readFile(this.authFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed.tokens?.access_token)
            throw new Error('auth file has no tokens');
        return parsed;
    }
    async writeAuth(auth) {
        await fs.writeFile(this.authFile, JSON.stringify(auth, null, 2), { mode: 0o600 });
    }
    /** Returns a valid access token + account id, refreshing if expired/near expiry. */
    async getAccessToken() {
        let auth = await this.readAuth();
        const exp = decodeJwtExp(auth.tokens.access_token);
        const nearExpiry = exp !== null && exp * 1000 - Date.now() < 5 * 60 * 1000;
        if (nearExpiry) {
            // Single-flight refresh
            if (!this.refreshing) {
                this.refreshing = this.refreshTokens().finally(() => {
                    this.refreshing = null;
                });
            }
            await this.refreshing;
            auth = await this.readAuth();
        }
        return { token: auth.tokens.access_token, accountId: auth.tokens.account_id };
    }
    async refreshTokens() {
        const auth = await this.readAuth();
        const res = await fetch(OAUTH_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'refresh_token',
                client_id: OAUTH_CLIENT_ID,
                refresh_token: auth.tokens.refresh_token,
                scope: 'openid profile email',
            }),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`ChatGPT token refresh failed: HTTP ${res.status} ${body.slice(0, 200)}`);
        }
        const data = (await res.json());
        if (!data.access_token)
            throw new Error('ChatGPT token refresh returned no access_token');
        auth.tokens.access_token = data.access_token;
        if (data.refresh_token)
            auth.tokens.refresh_token = data.refresh_token;
        if (data.id_token)
            auth.tokens.id_token = data.id_token;
        auth.last_refresh = new Date().toISOString();
        await this.writeAuth(auth);
        console.log('[ChatGPT] OAuth tokens refreshed');
    }
    /**
     * Run one model turn (streaming). Emits text deltas and collected tool calls
     * through callbacks; resolves with the full turn result.
     */
    async runTurn(options) {
        const { model, instructions, input, tools, callbacks } = options;
        // Vault proxy mode: the proxy holds the OAuth tokens; we present only
        // our per-app fv_ token and it swaps in the real credential.
        const { token, accountId } = USE_VAULT_PROXY
            ? { token: VAULT_PROXY_TOKEN, accountId: undefined }
            : await this.getAccessToken();
        const body = {
            model,
            instructions,
            input,
            stream: true,
            store: false,
        };
        if (tools && tools.length > 0) {
            body.tools = tools;
            body.tool_choice = 'auto';
        }
        const headers = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'responses=experimental',
            originator: 'codex_cli_rs',
            'User-Agent': 'floyd-desktop/0.1 (codex_cli_rs compatible)',
        };
        if (accountId)
            headers['chatgpt-account-id'] = accountId;
        const res = await fetch(USE_VAULT_PROXY ? `${VAULT_PROXY_URL}/v1/responses` : BACKEND_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        if (!res.ok || !res.body) {
            const errBody = await res.text().catch(() => '');
            throw new Error(`ChatGPT backend HTTP ${res.status}: ${errBody.slice(0, 300)}`);
        }
        const result = { text: '', toolCalls: [], outputItems: [] };
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:'))
                    continue;
                const payload = trimmed.slice(5).trim();
                if (!payload || payload === '[DONE]')
                    continue;
                let ev;
                try {
                    ev = JSON.parse(payload);
                }
                catch {
                    continue;
                }
                switch (ev.type) {
                    case 'response.output_text.delta':
                        result.text += ev.delta;
                        callbacks?.onText?.(ev.delta);
                        break;
                    case 'response.output_item.done': {
                        const item = ev.item;
                        if (item?.type === 'function_call') {
                            let args = {};
                            try {
                                args = JSON.parse(item.arguments || '{}');
                            }
                            catch {
                                /* leave empty */
                            }
                            const callId = item.call_id || item.id;
                            result.toolCalls.push({ name: item.name, args, callId });
                            result.outputItems.push({
                                type: 'function_call',
                                name: item.name,
                                arguments: item.arguments || '{}',
                                call_id: callId,
                            });
                            callbacks?.onToolCall?.(item.name, args, callId);
                        }
                        else if (item?.type === 'message') {
                            result.outputItems.push({
                                type: 'message',
                                role: item.role || 'assistant',
                                content: item.content || [{ type: 'output_text', text: result.text }],
                            });
                        }
                        break;
                    }
                    case 'response.failed':
                    case 'error': {
                        const msg = ev.response?.error?.message || ev.error?.message || ev.message || 'ChatGPT backend error';
                        callbacks?.onError?.(msg);
                        throw new Error(msg);
                    }
                }
            }
        }
        return result;
    }
}
/** Build user message content parts, supporting optional base64 images. */
export function userMessage(text, images) {
    const content = [];
    if (images) {
        for (const img of images) {
            content.push({ type: 'input_image', image_url: `data:${img.mediaType};base64,${img.base64}` });
        }
    }
    content.push({ type: 'input_text', text });
    return { type: 'message', role: 'user', content };
}
/** Wrap a prior assistant text reply for conversation history. */
export function assistantMessage(text) {
    return { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] };
}
/** Wrap a tool result for the next turn. */
export function toolResult(callId, output) {
    return {
        type: 'function_call_output',
        call_id: callId,
        output: typeof output === 'string' ? output : JSON.stringify(output),
    };
}
