"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Validator = void 0;
const AdminPermissionTable_1 = require("./tables/AdminPermissionTable");
const PriorityTable_1 = require("./tables/PriorityTable");
const QueueChannelTable_1 = require("./tables/QueueChannelTable");
class Validator {
    static async validateGuild(guild) {
        const cachedTime = this.timestampCache.get(guild.id);
        const now = Date.now();
        if (cachedTime && now - cachedTime < Validator.SIX_HOURS)
            return;
        this.timestampCache.set(guild.id, now);
        const me = guild.me;
        try {
            guild.channels.cache.clear();
            guild.members.cache.clear();
            guild.members.cache.set(me.id, me);
            const channels = Array.from((await guild.channels.fetch()).values());
            const members = Array.from((await guild.members.fetch()).values());
            const roles = Array.from((await guild.roles.fetch()).values());
            AdminPermissionTable_1.AdminPermissionTable.validate(guild, members, roles).then();
            const requireUpdate = await PriorityTable_1.PriorityTable.validate(guild, members, roles);
            QueueChannelTable_1.QueueChannelTable.validate(requireUpdate, guild, channels, members, roles).then();
        }
        catch (e) {
        }
    }
}
exports.Validator = Validator;
Validator.timestampCache = new Map();
Validator.SIX_HOURS = 1000 * 60 * 60 * 6;
