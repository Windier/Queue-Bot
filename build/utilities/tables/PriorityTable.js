"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PriorityTable = void 0;
const Base_1 = require("../Base");
class PriorityTable {
    static async initTable() {
        await Base_1.Base.knex.schema.hasTable("priority").then(async (exists) => {
            if (!exists) {
                await Base_1.Base.knex.schema
                    .createTable("priority", (table) => {
                    table.increments("id").primary();
                    table.bigInteger("guild_id");
                    table.bigInteger("role_member_id");
                    table.boolean("is_role");
                })
                    .catch((e) => console.error(e));
            }
        });
    }
    static get(guildId, roleMemberId) {
        return Base_1.Base.knex("priority")
            .where("guild_id", guildId)
            .where("role_member_id", roleMemberId)
            .first();
    }
    static getMany(guildId) {
        return Base_1.Base.knex("priority").where("guild_id", guildId);
    }
    static async isPriority(guildId, member) {
        const roleIds = member.roles.cache.keys();
        for (const id of [member.id, ...roleIds]) {
            const memberPerm = await Base_1.Base.knex("priority")
                .where("guild_id", guildId)
                .where("role_member_id", id)
                .first();
            if (memberPerm)
                return true;
        }
        return false;
    }
    static async store(guildId, roleMemberId, isRole) {
        await Base_1.Base.knex("priority").insert({
            guild_id: guildId,
            role_member_id: roleMemberId,
            is_role: isRole,
        });
    }
    static async unstore(guildId, roleMemberId) {
        let query = Base_1.Base.knex("priority").where("guild_id", guildId);
        if (roleMemberId)
            query = query.where("role_member_id", roleMemberId);
        await query.first().delete();
    }
    static async validate(guild, members, roles) {
        let updateRequired = false;
        const storedEntries = await this.getMany(guild.id);
        for await (const entry of storedEntries) {
            if (entry.is_role) {
                if (!roles.some((r) => r.id === entry.role_member_id)) {
                    await this.unstore(guild.id, entry.role_member_id);
                    updateRequired = true;
                }
            }
            else {
                const member = members.find((m) => m.id === entry.role_member_id);
                if (member) {
                }
                else {
                    await this.unstore(guild.id, entry.role_member_id);
                    updateRequired = true;
                }
            }
        }
        return updateRequired;
    }
}
exports.PriorityTable = PriorityTable;
