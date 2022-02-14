"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageCollection = void 0;
const discord_js_1 = require("discord.js");
const Base_1 = require("./Base");
class MessageCollection extends discord_js_1.LimitedCollection {
    set(key, value) {
        const msg = value;
        if (msg?.author?.id && msg.author.id !== Base_1.Base.client.user.id)
            return this;
        if (this.maxSize === 0)
            return this;
        if (this.size >= this.maxSize && !this.has(key)) {
            for (const [k, v] of this.entries()) {
                const keep = this.keepOverLimit?.(v, k, this) ?? false;
                if (!keep) {
                    this.delete(k);
                    break;
                }
            }
        }
        return super.set(key, value);
    }
}
exports.MessageCollection = MessageCollection;
