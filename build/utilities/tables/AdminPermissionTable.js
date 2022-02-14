"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminPermissionTable = void 0;
const Base_1 = require("../Base");
class AdminPermissionTable {
    static async initTable() {
        await Base_1.Base.knex.schema.hasTable("admin_permission").then(async (exists) => {
            if (!exists) {
                await Base_1.Base.knex.schema
                    .createTable("admin_permission", (table) => {
                    table.increments("id").primary();
                    table.bigInteger("guild_id");
                    table.bigInteger("role_member_id");
                    table.boolean("is_role");
                })
                    .catch((e) => console.error(e));
            }
        });
    }
    static async get(guildId, roleMemberId) {
        return Base_1.Base.knex("admin_permission")
            .where("guild_id", guildId)
            .where("role_member_id", roleMemberId)
            .first();
    }
    static async getMany(guildId) {
        return Base_1.Base.knex("admin_permission").where("guild_id", guildId);
    }
    static async store(guildId, roleMemberId, isRole) {
        await Base_1.Base.knex("admin_permission")
            .insert({
            guild_id: guildId,
            role_member_id: roleMemberId,
            is_role: isRole,
        })
            .catch(() => null);
    }
    static async unstore(guildId, roleMemberId) {
        let query = Base_1.Base.knex("admin_permission").where("guild_id", guildId);
        if (roleMemberId)
            query = query.where("role_member_id", roleMemberId);
        await query.first().delete();
    }
    static async validate(guild, members, roles) {
        const storedEntries = await this.getMany(guild.id);
        for await (const entry of storedEntries) {
            if (entry.is_role) {
                if (!roles.some((r) => r.id === entry.role_member_id)) {
                    await this.unstore(guild.id, entry.role_member_id);
                }
            }
            else {
                const member = members.find((m) => m.id === entry.role_member_id);
                if (member) {
                }
                else {
                    await this.unstore(guild.id, entry.role_member_id);
                }
            }
        }
    }
}
exports.AdminPermissionTable = AdminPermissionTable;
