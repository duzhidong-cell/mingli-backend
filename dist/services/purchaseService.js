"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOWED_PRODUCT_IDS = void 0;
exports.hasServiceAccount = hasServiceAccount;
exports.verifyGoogleSubscription = verifyGoogleSubscription;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const config_1 = require("../config");
/** 允许的订阅商品 ID 白名单 */
exports.ALLOWED_PRODUCT_IDS = ['monthly_pro', 'yearly_pro'];
function loadServiceAccount() {
    const p = (0, node_path_1.join)(process.cwd(), config_1.config.playServiceAccountPath);
    if (!(0, node_fs_1.existsSync)(p))
        return null;
    try {
        const j = JSON.parse((0, node_fs_1.readFileSync)(p, 'utf8'));
        if (j.client_email && j.private_key)
            return j;
        return null;
    }
    catch {
        return null;
    }
}
/** 是否已配置服务账号（真实校验模式） */
function hasServiceAccount() {
    return loadServiceAccount() !== null;
}
function b64url(input) {
    return Buffer.from(input).toString('base64url');
}
/* ------------ Google OAuth2 access token（缓存 50 分钟） ------------ */
let tokenCache = null;
async function getAccessToken(sa) {
    if (tokenCache && Date.now() < tokenCache.expireAt)
        return tokenCache.token;
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/androidpublisher',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    }));
    const input = `${header}.${claim}`;
    const signature = (0, node_crypto_1.createSign)('RSA-SHA256').update(input).sign(sa.private_key);
    const jwt = `${input}.${b64url(signature)}`;
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Google OAuth 失败 (${res.status}): ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    tokenCache = { token: data.access_token, expireAt: Date.now() + Math.min(data.expires_in - 600, 3000) * 1000 };
    return data.access_token;
}
function mapState(state, expiryMs, hasOfferId) {
    switch (state) {
        case 'SUBSCRIPTION_STATE_ACTIVE':
            return hasOfferId ? 'in_trial' : 'active'; // 有 offerId（免费试用/优惠期）近似视为试用
        case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
            return 'grace_period';
        case 'SUBSCRIPTION_STATE_ON_HOLD':
            return 'on_hold';
        case 'SUBSCRIPTION_STATE_CANCELED':
            // 已取消续订但可能仍在有效期内
            return expiryMs > Date.now() ? 'active' : 'expired';
        case 'SUBSCRIPTION_STATE_EXPIRED':
            return 'expired';
        default:
            return 'unknown';
    }
}
/**
 * 校验 Google Play 订阅。
 * - 已配置服务账号：调 androidpublisher subscriptionsv2 真实校验。
 * - 未配置：「沙盒直通」模式，信任客户端（仅限内测阶段，日志会警告）。
 */
async function verifyGoogleSubscription(productId, purchaseToken) {
    const sa = loadServiceAccount();
    if (!sa) {
        console.warn('[订阅] 未配置 Google 服务账号，沙盒直通模式（切勿用于正式环境）');
        return {
            productId,
            status: 'active',
            expiryTimeMillis: Date.now() + 31 * 24 * 60 * 60 * 1000,
            autoRenewing: true,
            verifiedMode: 'trust',
        };
    }
    const token = await getAccessToken(sa);
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(config_1.config.playPackageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404 || res.status === 400) {
        throw Object.assign(new Error('购买凭证无效或已失效'), { statusCode: 400 });
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Google Play 校验失败 (${res.status}): ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const line = (data.lineItems || [])[0] || {};
    const expiryMs = line.expiryTime ? Date.parse(line.expiryTime) || 0 : 0;
    const status = mapState(String(data.subscriptionState || ''), expiryMs, !!line.offerDetails?.offerId);
    return {
        productId: line.productId || productId,
        status,
        expiryTimeMillis: expiryMs,
        autoRenewing: !!line.autoRenewingPlan?.autoRenewEnabled,
        verifiedMode: 'google',
    };
}
//# sourceMappingURL=purchaseService.js.map