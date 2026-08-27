import { Converter } from 'opencc-js';
const toHK = Converter({ from: 'cn', to: 'hk' });
/** 将简体中文转换为繁体（香港用语，如 裏/裡、訊息/資訊 用港版写法）。非字符串原样返回。 */
export function tw(value) {
    if (typeof value === 'string')
        return toHK(value);
    if (Array.isArray(value))
        return value.map(tw);
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value))
            out[k] = tw(v);
        return out;
    }
    return value;
}
//# sourceMappingURL=zhTradition.js.map