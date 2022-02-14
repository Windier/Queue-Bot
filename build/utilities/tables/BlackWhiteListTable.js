"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlackWhiteListTable = void 0;
const Base_1 = require("../Base");
class BlackWhiteListTable {
    static async initTable() {
        await Base_1.Base.knex.schema.hasTable("black_white_list").then(async (exists) => {
            if (!exists) {
                await Base_1.Base.knex.schema
                    .createTable("black_white_list", (table) => {
                    table.increments("id").primary();
                    table.bigInteger("queue_channel_id");
                    table.bigInteger("role_member_id");
                    table.integer("type");
                    table.boolean("is_role");
                })
                    .catch((e) => console.error(e));
            }
        });
    }
    static async isBWlisted(queueChannelId, member, type) {
        const roleIds = Array.from(member.roles.valueOf().keys());
        for await (const id of [member.id, ...roleIds]) {
            const memberPerm = await Base_1.Base.knex("black_white_list")
                .where("queue_channel_id", queueChannelId)
                .where("role_member_id", id)
                .where("type", type)
                .first();
            if (memberPerm)
                return true;
        }
        return false;
    }
    static async isBlacklisted(queueChannelId, member) {
        return await this.isBWlisted(queueChannelId, member, 0);
    }
    static async isWhitelisted(queueChannelId, member) {
        return await this.isBWlisted(queueChannelId, member, 1);
    }
    static async hasWhitelist(queueChannelId) {
        return ((await Base_1.Base.knex("black_white_list")
            .where("queue_channel_id", queueChannelId)
            .where("type", 1)
            .first()) != null);
    }
    static get(type, queueChannelId, roleMemberId) {
        return Base_1.Base.knex("black_white_list")
            .where("queue_channel_id", queueChannelId)
            .where("role_member_id", roleMemberId)
            .where("type", type)
            .first();
    }
    static getMany(type, queueChannelId) {
        return Base_1.Base.knex("black_white_list")
            .where("queue_channel_id", queueChannelId)
            .where("type", type);
    }
    static async store(type, queueChannelId, roleMemberId, isRole) {
        await Base_1.Base.knex("black_white_list").insert({
            queue_channel_id: queueChannelId,
            role_member_id: roleMemberId,
            type: type,
            is_role: isRole,
        });
    }
    static async unstore(type, queueChannelId, roleMemberId) {
        let query = Base_1.Base.knex("black_white_list").where("queue_channel_id", queueChannelId);
        if (type !== 2)
            query = query.where("type", type);
        if (roleMemberId)
            query = query.where("role_member_id", roleMemberId);
        await query.delete();
    }
    static async validate(queueChannel, members, roles) {
        let updateRequired = false;
        for await (const type of [0, 1]) {
            const storedEntries = await this.getMany(type, queueChannel.id);
            for await (const entry of storedEntries) {
                if (entry.is_role) {
                    if (!roles.some((r) => r.id === entry.role_member_id)) {
                        await this.unstore(type, entry.queue_channel_id, entry.role_member_id);
                        updateRequired = true;
                    }
                }
                else {
                    const member = members.find((m) => m.id === entry.role_member_id);
                    if (member) {
                    }
                    else {
                        await this.unstore(type, entry.queue_channel_id, entry.role_member_id);
                        updateRequired = true;
                    }
                }
            }
        }
        return updateRequired;
    }
}
exports.BlackWhiteListTable = BlackWhiteListTable;
