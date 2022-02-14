"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueGuildTable = void 0;
const Base_1 = require("../Base");
const QueueChannelTable_1 = require("./QueueChannelTable");
const AdminPermissionTable_1 = require("./AdminPermissionTable");
const PriorityTable_1 = require("./PriorityTable");
class QueueGuildTable {
    static async initTable() {
        await Base_1.Base.knex.schema.hasTable("queue_guilds").then(async (exists) => {
            if (!exists) {
                await Base_1.Base.knex.schema
                    .createTable("queue_guilds", (table) => {
                    table.bigInteger("guild_id").primary();
                    table.boolean("disable_mentions");
                    table.boolean("disable_roles");
                    table.integer("msg_mode");
                    table.boolean("enable_alt_prefix");
                })
                    .catch((e) => console.error(e));
            }
        });
    }
    static get(guildId) {
        return Base_1.Base.knex("queue_guilds").where("guild_id", guildId).first();
    }
    static async setDisableMentions(guildId, value) {
        await this.get(guildId).update("disable_mentions", value);
    }
    static async setDisableRoles(guildId, value) {
        await this.get(guildId).update("disable_roles", value);
    }
    static async setMessageMode(guildId, mode) {
        await this.get(guildId).update("msg_mode", mode);
    }
    static async setAltPrefix(guildId, value) {
        await this.get(guildId).update("enable_alt_prefix", value);
    }
    static async store(guild) {
        await Base_1.Base.knex("queue_guilds").insert({ guild_id: guild.id, msg_mode: 1 });
    }
    static async unstore(guildId) {
        await QueueChannelTable_1.QueueChannelTable.unstore(guildId);
        await AdminPermissionTable_1.AdminPermissionTable.unstore(guildId);
        await PriorityTable_1.PriorityTable.unstore(guildId);
        await Base_1.Base.knex("queue_guilds").where("guild_id", guildId).delete();
    }
}
exports.QueueGuildTable = QueueGuildTable;
