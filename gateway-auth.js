'use strict';
/**
 * Gateway 鉴权与 Control UI 配置守卫（零环境首启安全）。
 * 保证：磁盘上的 token、仪表盘 URL、OPENCLAW_GATEWAY_TOKEN 永远同一套。
 */

const DEFAULT_GATEWAY_TOKEN = 'openclaw-dev-token-998877';
const DEFAULT_PORT = 18789;
const DEFAULT_BASE_PATH = '/acp';

function isUsableToken(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 规范化 gateway.auth / controlUi / port。
 * @returns {{ config: object, changed: boolean, token: string, port: number }}
 */
function normalizeGatewayAuthConfig(config, defaultToken = DEFAULT_GATEWAY_TOKEN) {
    const cfg = config && typeof config === 'object' ? config : {};
    let changed = false;

    if (!cfg.gateway || typeof cfg.gateway !== 'object') {
        cfg.gateway = {};
        changed = true;
    }
    if (!cfg.gateway.auth || typeof cfg.gateway.auth !== 'object') {
        cfg.gateway.auth = {};
        changed = true;
    }
    if (cfg.gateway.auth.mode !== 'token') {
        cfg.gateway.auth.mode = 'token';
        changed = true;
    }
    // SecretRef 对象 / 非字符串 / 空白 → 固定默认令牌（禁止留给 OpenClaw 生成 runtime token）
    if (!isUsableToken(cfg.gateway.auth.token)) {
        cfg.gateway.auth.token = defaultToken;
        changed = true;
    }

    if (!cfg.gateway.controlUi || typeof cfg.gateway.controlUi !== 'object') {
        cfg.gateway.controlUi = {};
        changed = true;
    }
    if (cfg.gateway.controlUi.basePath !== DEFAULT_BASE_PATH) {
        cfg.gateway.controlUi.basePath = DEFAULT_BASE_PATH;
        changed = true;
    }

    const portNum = Number(cfg.gateway.port);
    if (!(portNum > 0)) {
        cfg.gateway.port = DEFAULT_PORT;
        changed = true;
    }

    if (cfg.gateway.mode !== 'local' && cfg.gateway.mode !== 'remote') {
        cfg.gateway.mode = 'local';
        changed = true;
    }

    return {
        config: cfg,
        changed,
        token: String(cfg.gateway.auth.token).trim(),
        port: Number(cfg.gateway.port) || DEFAULT_PORT
    };
}

function buildControlUiUrl(port, token) {
    const p = Number(port) > 0 ? Number(port) : DEFAULT_PORT;
    const t = isUsableToken(token) ? String(token).trim() : DEFAULT_GATEWAY_TOKEN;
    const enc = encodeURIComponent(t);
    return `http://127.0.0.1:${p}${DEFAULT_BASE_PATH}/?token=${enc}#token=${enc}`;
}

/**
 * 把鉴权字段同步进其它可能被旧版 patch 读到的状态目录（消除双目录分叉）。
 * 只改 gateway.auth / controlUi.basePath / port，不覆盖其它业务配置。
 */
function syncGatewayAuthToStateDirs(stateDirs, authPayload) {
    const fs = require('fs');
    const path = require('path');
    const token = isUsableToken(authPayload.token) ? String(authPayload.token).trim() : DEFAULT_GATEWAY_TOKEN;
    const mode = authPayload.mode || 'token';
    const port = Number(authPayload.port) > 0 ? Number(authPayload.port) : DEFAULT_PORT;
    const synced = [];

    const uniq = [];
    for (const dir of stateDirs || []) {
        if (!dir) continue;
        const resolved = path.resolve(String(dir));
        if (!uniq.includes(resolved)) uniq.push(resolved);
    }

    for (const dir of uniq) {
        const cf = path.join(dir, 'openclaw.json');
        try {
            // 只修补已存在的配置，避免在备用目录生成「只有 auth 的空壳」覆盖业务配置
            if (!fs.existsSync(cf)) continue;
            const cfg = JSON.parse(fs.readFileSync(cf, 'utf8').replace(/^\uFEFF/, ''));
            const before = JSON.stringify({
                auth: cfg.gateway && cfg.gateway.auth,
                port: cfg.gateway && cfg.gateway.port,
                basePath: cfg.gateway && cfg.gateway.controlUi && cfg.gateway.controlUi.basePath
            });
            const norm = normalizeGatewayAuthConfig(cfg, token);
            norm.config.gateway.auth.mode = mode;
            norm.config.gateway.auth.token = token;
            norm.config.gateway.port = port;
            const after = JSON.stringify({
                auth: norm.config.gateway.auth,
                port: norm.config.gateway.port,
                basePath: norm.config.gateway.controlUi && norm.config.gateway.controlUi.basePath
            });
            if (before !== after) {
                fs.writeFileSync(cf, JSON.stringify(norm.config, null, 2) + '\n', 'utf8');
                synced.push(dir);
            }
        } catch (e) {
            // 忽略单个目录失败，主 CONFIG_PATH 仍由调用方保证
        }
    }
    return synced;
}

/** 组装 fork 网关子进程必须继承的 OPENCLAW_* / 令牌环境 */
function buildGatewayChildEnv(baseEnv, opts) {
    const homePath = opts.homePath;
    const stateDir = opts.stateDir;
    const token = isUsableToken(opts.token) ? String(opts.token).trim() : DEFAULT_GATEWAY_TOKEN;
    return {
        ...baseEnv,
        USERPROFILE: homePath,
        HOME: homePath,
        REAL_USER_HOME: homePath,
        OPENCLAW_HOME: homePath,
        OPENCLAW_STATE_DIR: stateDir,
        // OpenClaw ensureGatewayStartupAuth 会优先认环境变量，作为配置分叉时的最后保险
        OPENCLAW_GATEWAY_TOKEN: token
    };
}

module.exports = {
    DEFAULT_GATEWAY_TOKEN,
    DEFAULT_PORT,
    DEFAULT_BASE_PATH,
    isUsableToken,
    normalizeGatewayAuthConfig,
    buildControlUiUrl,
    syncGatewayAuthToStateDirs,
    buildGatewayChildEnv
};
